import { http, HttpResponse } from "msw";
import type { Document, DocumentType, ErrorCode, Problem, Project } from "@/api/types";
import { extensionsByType, fileExtension, MAX_FILE_BYTES } from "@/features/documents/validateFile";
import { activeDocuments, addActivity, advance, db, knowledgeBaseView, nextUuid } from "./db";

const API = "*/api/v1";
const DOCUMENT_TYPES: DocumentType[] = ["REQUIREMENT", "API_SPEC", "CATALOG", "TEST_DATA"];
const EXT_CONTENT_TYPE: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  yaml: "application/yaml",
  yml: "application/yaml",
  json: "application/json",
  csv: "text/csv",
};

export function problem(status: number, code: ErrorCode, title: string, detail?: string) {
  const body: Problem = { status, code, title, detail };
  return HttpResponse.json(body, { status, headers: { "Content-Type": "application/problem+json" } });
}

const notFound = () => problem(404, "RESOURCE_NOT_FOUND", "대상 없음", "요청한 대상을 찾을 수 없습니다.");

function findProject(id: string | readonly string[] | undefined): Project | undefined {
  return db.projects.find((p) => p.id === id);
}

export const handlers = [
  http.get(`${API}/me`, () => HttpResponse.json(db.user)),

  http.get(`${API}/projects`, () => HttpResponse.json({ items: db.projects })),

  http.post(`${API}/projects`, async ({ request }) => {
    const body = await request.json();
    const name = typeof body === "object" && body !== null && "name" in body && typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return problem(400, "VALIDATION_FAILED", "입력값 오류", "프로젝트 이름을 입력해 주세요.");
    const now = new Date().toISOString();
    const project: Project = { id: nextUuid(), name, targetUrl: null, targetUrlStatus: "UNVERIFIED", targetCheckedAt: null, targetCheckStatusCode: null, targetCheckMessage: null, queryApiBaseUrl: null, testControlUrl: null, createdAt: now, updatedAt: now };
    db.projects.push(project);
    return HttpResponse.json(project, { status: 201 });
  }),

  http.get(`${API}/projects/:projectId`, ({ params }) => {
    const project = findProject(params.projectId);
    return project ? HttpResponse.json(project) : notFound();
  }),

  http.patch(`${API}/projects/:projectId`, async ({ params, request }) => {
    const project = findProject(params.projectId);
    if (!project) return notFound();
    const body = await request.json();
    if (typeof body === "object" && body !== null && "targetUrl" in body && typeof body.targetUrl === "string") {
      if (!/^https?:\/\//.test(body.targetUrl)) {
        const res: Problem = { status: 400, code: "VALIDATION_FAILED", title: "입력값 오류", fieldErrors: [{ field: "targetUrl", message: "URL 형식이 아닙니다." }] };
        return HttpResponse.json(res, { status: 400, headers: { "Content-Type": "application/problem+json" } });
      }
      if (body.targetUrl !== project.targetUrl) {
        project.targetUrl = body.targetUrl;
        project.targetUrlStatus = "UNVERIFIED";
        project.targetCheckedAt = null;
        project.targetCheckStatusCode = null;
        project.targetCheckMessage = null;
      }
    }
    project.updatedAt = new Date().toISOString();
    return HttpResponse.json(project);
  }),

  http.post(`${API}/projects/:projectId/target-verification`, ({ params }) => {
    const project = findProject(params.projectId);
    if (!project) return notFound();
    if (!project.targetUrl) return problem(409, "TARGET_URL_MISSING", "대상 사이트 URL 없음", "대상 사이트 URL을 먼저 입력해 주세요.");
    // ADR-019: 주소로 결과를 고른다. runner-down → 503, unreachable → 시간 초과, auth → 401(도달 가능), 그 밖 200
    if (project.targetUrl.includes("runner-down")) {
      return problem(503, "DEPENDENCY_UNAVAILABLE", "실행기 연결 실패", "Playwright 실행기에 연결할 수 없어 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    const unreachable = project.targetUrl.includes("unreachable");
    const statusCode = unreachable ? null : project.targetUrl.includes("auth") ? 401 : 200;
    const checkedAt = new Date().toISOString();
    project.targetUrlStatus = unreachable ? "UNREACHABLE" : "REACHABLE";
    project.targetCheckedAt = checkedAt;
    project.targetCheckStatusCode = statusCode;
    project.targetCheckMessage = unreachable ? "연결 시간 초과 (10초)" : statusCode === 401 ? "서버가 응답했습니다 (인증 필요)" : null;
    addActivity(unreachable ? "대상 사이트 연결 확인 실패" : `대상 사이트 연결 확인 · HTTP ${statusCode}`);
    return HttpResponse.json({
      status: project.targetUrlStatus,
      checkedAt,
      statusCode,
      message: project.targetCheckMessage,
    });
  }),

  http.get(`${API}/projects/:projectId/documents`, ({ params }) => {
    if (!findProject(params.projectId)) return notFound();
    const projectId = String(params.projectId);
    advance(projectId);
    return HttpResponse.json({ items: activeDocuments(projectId) });
  }),

  http.post(`${API}/projects/:projectId/documents`, async ({ params, request }) => {
    if (!findProject(params.projectId)) return notFound();
    const projectId = String(params.projectId);
    const form = await request.formData();
    const typeValue = form.get("type");
    const file = form.get("file");
    const type = DOCUMENT_TYPES.find((t) => t === typeValue);
    if (!type || !(file instanceof Blob)) return problem(400, "VALIDATION_FAILED", "입력값 오류", "type과 file이 필요합니다.");
    const filename = file instanceof File ? file.name : "upload";
    if (file.size > MAX_FILE_BYTES) return problem(413, "FILE_TOO_LARGE", "파일 크기 초과", "파일당 20MB 이하만 올릴 수 있습니다.");
    const ext = fileExtension(filename);
    const contentType = EXT_CONTENT_TYPE[ext];
    if (!contentType || !extensionsByType[type].includes(ext)) {
      return problem(400, "UNSUPPORTED_FILE_TYPE", "지원하지 않는 형식", `${type}는 ${extensionsByType[type].join(", ")} 파일만 올릴 수 있습니다.`);
    }

    const previous = activeDocuments(projectId).find((d) => d.type === type);
    if (previous) previous.isActive = false;
    const changesIndex = type !== "TEST_DATA";
    const doc: Document = {
      id: nextUuid(),
      projectId,
      type,
      version: (previous?.version ?? 0) + 1,
      isActive: true,
      originalFilename: filename,
      contentType,
      sizeBytes: file.size,
      status: type === "TEST_DATA" ? "REGISTERED" : "UPLOADED",
      indexProgress: 0,
      summary: type === "TEST_DATA" ? { variableCount: 0, secretCount: 0 } : {},
      errorMessage: null,
      createdAt: new Date().toISOString(),
    };
    db.documents.push(doc);
    // TEST_DATA는 AI로 보내지 않으므로 지식 베이스를 낡게 만들지 않는다 (ADR-020)
    if (changesIndex && db.kb.status === "READY") db.kb.status = "STALE";
    addActivity(`${filename} 업로드 · S3 저장`);
    return HttpResponse.json(doc, { status: 201 });
  }),

  http.get(`${API}/documents/:documentId`, ({ params }) => {
    const doc = db.documents.find((d) => d.id === params.documentId);
    return doc ? HttpResponse.json(doc) : notFound();
  }),

  http.delete(`${API}/documents/:documentId`, ({ params }) => {
    const doc = db.documents.find((d) => d.id === params.documentId && d.isActive);
    if (!doc) return notFound();
    if (db.kb.status === "BUILDING") return problem(409, "INVALID_STATE_TRANSITION", "삭제할 수 없음", "지식 베이스 구축 중에는 문서를 삭제할 수 없습니다.");
    doc.isActive = false;
    if (doc.type !== "TEST_DATA" && db.kb.status === "READY") db.kb.status = "STALE";
    addActivity(`${doc.originalFilename} 삭제`);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${API}/documents/:documentId/download-link`, ({ params }) => {
    const doc = db.documents.find((d) => d.id === params.documentId);
    if (!doc) return notFound();
    return HttpResponse.json({
      url: `https://example.com/mock-s3/${encodeURIComponent(doc.originalFilename)}`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
  }),

  http.get(`${API}/document-templates/:documentType`, ({ params }) => {
    const type = DOCUMENT_TYPES.find((t) => t === params.documentType);
    if (!type) return notFound();
    const filename = `${type.toLowerCase()}-template.md`;
    return new HttpResponse(`# ${type} 템플릿 (목)\n`, {
      headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${filename}"` },
    });
  }),

  http.get(`${API}/projects/:projectId/knowledge-base`, ({ params }) => {
    if (!findProject(params.projectId)) return notFound();
    return HttpResponse.json(knowledgeBaseView(String(params.projectId)));
  }),

  http.post(`${API}/projects/:projectId/knowledge-base/build`, ({ params }) => {
    if (!findProject(params.projectId)) return notFound();
    const view = knowledgeBaseView(String(params.projectId));
    if (view.missingDocumentTypes.length > 0) {
      const body: Problem = {
        status: 409,
        code: "MISSING_REQUIRED_DOCUMENTS",
        title: "필수 문서 누락",
        detail: `필수 문서가 빠져 있습니다: ${view.missingDocumentTypes.join(", ")}`,
        missingDocumentTypes: view.missingDocumentTypes,
      };
      return HttpResponse.json(body, { status: 409, headers: { "Content-Type": "application/problem+json" } });
    }
    if (db.kb.status === "BUILDING") return problem(409, "INVALID_STATE_TRANSITION", "이미 구축 중", "지식 베이스를 이미 구축하고 있습니다.");
    if (db.kb.status === "READY") return problem(409, "INVALID_STATE_TRANSITION", "이미 최신", "지식 베이스가 이미 최신입니다.");
    db.kb.status = "BUILDING";
    db.kb.buildPolls = 0;
    // 구축(재구축 포함)을 시작하면 활성 필수 문서 3종이 모두 INDEXING이 된다 (state-machines.md Document)
    db.kb.errorMessage = null;
    for (const doc of activeDocuments(String(params.projectId))) {
      if (doc.type !== "TEST_DATA") {
        doc.status = "INDEXING";
        doc.indexProgress = 0;
        doc.errorMessage = null;
      }
    }
    addActivity("지식 베이스 구축 시작");
    return HttpResponse.json(knowledgeBaseView(String(params.projectId)), { status: 202 });
  }),

  http.get(`${API}/projects/:projectId/activities`, ({ params, request }) => {
    if (!findProject(params.projectId)) return notFound();
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 10);
    return HttpResponse.json({ items: db.activities.slice(0, limit) });
  }),
];
