// MSW 목의 메모리 상태. 응답 모양은 생성된 API 타입으로 검사한다.
// 초기 값은 계약 예시와 UI-01 캡처의 상황(카탈로그 누락, API 명세 인덱싱 중)을 재현한다. 화면 코드에는 쓰지 않는다.
import type { Activity, Document, DocumentType, KnowledgeBase, Project, User } from "@/api/types";

export const MOCK_PROJECT_ID = "6f1c2a52-8a3e-4c5b-9d7e-1a2b3c4d5e01";

interface MockDb {
  user: User;
  projects: Project[];
  documents: Document[];
  kb: Omit<KnowledgeBase, "missingDocumentTypes" | "canBuild" | "readiness"> & { buildPolls: number };
  activities: Activity[];
  seq: number;
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function initialDb(): MockDb {
  const projectId = MOCK_PROJECT_ID;
  return {
    user: { id: "0b6e3f0e-2f7c-4f1d-9a51-3e4d5c6b7a01", displayName: "박영서", roleLabel: "QA 담당자" },
    projects: [
      {
        id: projectId,
        name: "목업 쇼핑몰 v1.2",
        targetUrl: "https://shop-mock.skrr.dev",
        targetUrlStatus: "REACHABLE",
        targetCheckedAt: minutesAgo(20),
        targetCheckStatusCode: 200,
        targetCheckMessage: null,
        queryApiBaseUrl: null,
        testControlUrl: null,
        createdAt: minutesAgo(60 * 24 * 3),
        updatedAt: minutesAgo(20),
      },
    ],
    documents: [
      {
        id: "a1000000-0000-4000-8000-000000000001",
        projectId,
        type: "REQUIREMENT",
        version: 3,
        isActive: true,
        originalFilename: "requirements_v3.pdf",
        contentType: "application/pdf",
        sizeBytes: 2_516_582,
        status: "INDEXED",
        indexProgress: 100,
        summary: { requirementCount: 42 },
        errorMessage: null,
        createdAt: minutesAgo(15),
      },
      {
        id: "a1000000-0000-4000-8000-000000000002",
        projectId,
        type: "API_SPEC",
        version: 1,
        isActive: true,
        originalFilename: "openapi_shop.yaml",
        contentType: "application/yaml",
        sizeBytes: 184_320,
        // ADR-018: 업로드만 하면 구축 대기. 캡처의 "인덱싱 중 68%"는 구축 중에만 나온다.
        status: "UPLOADED",
        indexProgress: 0,
        summary: {},
        errorMessage: null,
        createdAt: minutesAgo(5),
      },
      {
        id: "a1000000-0000-4000-8000-000000000004",
        projectId,
        type: "TEST_DATA",
        version: 1,
        isActive: true,
        originalFilename: "seed_accounts.json",
        contentType: "application/json",
        sizeBytes: 40_960,
        status: "REGISTERED",
        indexProgress: 0,
        summary: { variableCount: 12, secretCount: 3 },
        errorMessage: null,
        createdAt: minutesAgo(30),
      },
    ],
    kb: {
      projectId,
      status: "STALE",
      chunkCount: 1284,
      requirementCount: 42,
      apiCount: 18,
      uiElementCount: 0,
      lastSyncedAt: minutesAgo(3),
      errorMessage: null,
      buildPolls: 0,
    },
    activities: [
      { id: 3, message: "openapi_shop.yaml 업로드 · S3 저장", createdAt: minutesAgo(3) },
      { id: 2, message: "requirements_v3.pdf 임베딩 완료", createdAt: minutesAgo(12) },
      { id: 1, message: "대상 사이트 연결 확인 · HTTP 200", createdAt: minutesAgo(15) },
    ],
    seq: 100,
  };
}

export let db: MockDb = initialDb();

export function resetMockDb() {
  db = initialDb();
}

export const REQUIRED_TYPES: DocumentType[] = ["REQUIREMENT", "API_SPEC", "CATALOG"];

// 인덱싱이 끝나면 채워지는 요약 (키는 platform-api Document.summary)
const INDEXED_SUMMARY: Record<DocumentType, Record<string, number>> = {
  REQUIREMENT: { requirementCount: 42 },
  API_SPEC: { endpointCount: 18 },
  CATALOG: { elementCount: 64, pageCount: 6 },
  TEST_DATA: {},
};

export function addActivity(message: string) {
  db.seq += 1;
  db.activities.unshift({ id: db.seq, message, createdAt: new Date().toISOString() });
}

export function nextUuid(): string {
  db.seq += 1;
  return `b2000000-0000-4000-8000-${db.seq.toString().padStart(12, "0")}`;
}

export function activeDocuments(projectId: string): Document[] {
  return db.documents.filter((d) => d.projectId === projectId && d.isActive);
}

/** 조회할 때마다 인덱싱과 구축을 한 단계씩 진행시킨다. */
export function advance(projectId: string) {
  for (const doc of activeDocuments(projectId)) {
    if (doc.status === "INDEXING") {
      doc.indexProgress = Math.min(100, doc.indexProgress + 30);
      if (doc.indexProgress >= 100) {
        doc.status = "INDEXED";
        doc.summary = INDEXED_SUMMARY[doc.type];
        addActivity(`${doc.originalFilename} 임베딩 완료`);
      }
    }
  }
  if (db.kb.status === "BUILDING") {
    db.kb.buildPolls += 1;
    // 파일 이름에 "broken"이 있으면 그 문서 때문에 구축이 실패한다 (FAILED + 나머지 SKIPPED, ADR-020).
    const broken = activeDocuments(projectId).find((d) => d.status === "INDEXING" && d.originalFilename.includes("broken"));
    if (broken && db.kb.buildPolls >= 2) {
      for (const doc of activeDocuments(projectId)) {
        if (doc.status !== "INDEXING" && doc.status !== "INDEXED") continue;
        if (doc === broken) {
          doc.status = "FAILED";
          doc.errorMessage = `${doc.originalFilename}을 읽지 못했습니다 (DOCUMENT_PARSE_FAILED)`;
        } else {
          doc.status = "SKIPPED";
          doc.errorMessage = `${broken.originalFilename} 오류로 이번 구축에서 처리하지 않았습니다`;
        }
      }
      db.kb.status = "FAILED";
      db.kb.errorMessage = `${broken.originalFilename} 처리 실패`;
      addActivity("지식 베이스 구축 실패");
    } else if (db.kb.buildPolls >= 3) {
      db.kb.status = "READY";
      db.kb.lastSyncedAt = new Date().toISOString();
      db.kb.chunkCount += 120;
      db.kb.uiElementCount = activeDocuments(projectId).some((d) => d.type === "CATALOG") ? 64 : 0;
      addActivity("지식 베이스 구축 완료");
    }
  }
}

export function knowledgeBaseView(projectId: string): KnowledgeBase {
  const docs = activeDocuments(projectId);
  const has = (type: DocumentType) => docs.some((d) => d.type === type);
  const missingDocumentTypes = REQUIRED_TYPES.filter((t) => !has(t));
  const project = db.projects.find((p) => p.id === projectId);
  const { buildPolls: _ignored, ...kb } = db.kb;
  void _ignored;
  return {
    ...kb,
    projectId,
    missingDocumentTypes,
    // state-machines.md: 필수 3종이 있고 BUILDING으로 옮길 수 있는 상태(NOT_BUILT, STALE, FAILED)일 때만
    canBuild: missingDocumentTypes.length === 0 && ["NOT_BUILT", "STALE", "FAILED"].includes(db.kb.status),
    readiness: [
      { key: "TARGET_REACHABLE", label: "대상 사이트 접속 가능", satisfied: project?.targetUrlStatus === "REACHABLE" },
      { key: "REQUIREMENT_ID_FORMAT", label: "요구사항 ID(FR-xx) 형식 인식", satisfied: has("REQUIREMENT") },
      { key: "READ_ONLY_QUERY_API", label: "DB 확인용 읽기 전용 조회 API 명세", satisfied: has("API_SPEC") },
      { key: "CATALOG_TESTID_MAPPED", label: "카탈로그의 data-testid 매핑", satisfied: docs.some((d) => d.type === "CATALOG" && d.status === "INDEXED") },
    ],
  };
}
