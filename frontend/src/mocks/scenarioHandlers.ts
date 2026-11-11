import { http, HttpResponse } from "msw";
import type { ExpectedValue, Problem } from "@/api/types";
import { db } from "./db";
import { problem } from "./handlers";
import {
  activeCases,
  advanceRequest,
  advanceScenarios,
  createRequest,
  scenarioList,
  sdb,
  selectCandidate,
  startRegeneration,
  viewScenario,
} from "./scenarioDb";

const API = "*/api/v1";

const notFound = () => problem(404, "RESOURCE_NOT_FOUND", "대상 없음", "요청한 대상을 찾을 수 없습니다.");
const invalidState = (detail: string) => problem(409, "INVALID_STATE_TRANSITION", "지금 상태에서 할 수 없음", detail);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validationProblem(fieldErrors: { field: string; message: string }[]) {
  const body: Problem = { status: 400, code: "VALIDATION_FAILED", title: "입력값 오류", fieldErrors };
  return HttpResponse.json(body, { status: 400, headers: { "Content-Type": "application/problem+json" } });
}

const findScenario = (id: unknown) => sdb.scenarios.find((s) => s.id === id);
const processing = (status: string) => status === "GENERATING" || status === "GUARD_RETRY";
const editable = ["REVIEW_REQUIRED", "APPROVED", "REJECTED", "GUARD_FAILED"];

/** ADR-017: expected와 consistencyOnly 중 하나, consistencyOnly면 reason 필수 */
function checkExpectedValues(values: unknown): { field: string; message: string }[] {
  if (!Array.isArray(values) || values.length === 0) return [{ field: "expectedValues", message: "기대값이 1개 이상 필요합니다." }];
  const errors: { field: string; message: string }[] = [];
  values.forEach((value, i) => {
    if (!isRecord(value) || typeof value.label !== "string" || !value.label.trim()) {
      errors.push({ field: `expectedValues[${i}].label`, message: "검증 항목이 필요합니다." });
      return;
    }
    const hasExpected = typeof value.expected === "string" && value.expected.length > 0;
    const consistency = value.consistencyOnly === true;
    if (hasExpected === consistency) errors.push({ field: `expectedValues[${i}]`, message: "expected와 consistencyOnly 중 하나만 써야 합니다." });
    if (consistency && (typeof value.reason !== "string" || !value.reason.trim()))
      errors.push({ field: `expectedValues[${i}].reason`, message: "consistencyOnly에는 이유가 필요합니다." });
  });
  return errors;
}

function toExpectedValues(values: unknown[]): ExpectedValue[] {
  return values.filter(isRecord).map((v) => ({
    label: String(v.label),
    ...(v.consistencyOnly === true ? { consistencyOnly: true, reason: String(v.reason) } : { expected: String(v.expected) }),
  }));
}

export const scenarioHandlers = [
  http.get(`${API}/projects/:projectId/test-requests`, ({ params }) => {
    const items = sdb.requests.filter((r) => r.projectId === params.projectId);
    items.forEach(advanceRequest);
    return HttpResponse.json({ items, nextCursor: null });
  }),

  http.post(`${API}/projects/:projectId/test-requests`, async ({ params, request }) => {
    if (!db.projects.some((p) => p.id === params.projectId)) return notFound();
    if (db.kb.status !== "READY") {
      return problem(409, "KNOWLEDGE_BASE_NOT_READY", "지식 베이스 준비 안 됨", "지식 베이스가 최신 상태가 아닙니다. 구축한 뒤 다시 시도해 주세요.");
    }
    const body = await request.json();
    const text = isRecord(body) && typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 500) return validationProblem([{ field: "text", message: "요청은 1~500자로 적어 주세요." }]);
    return HttpResponse.json(createRequest(String(params.projectId), text), { status: 202 });
  }),

  http.get(`${API}/test-requests/:testRequestId`, ({ params }) => {
    const request = sdb.requests.find((r) => r.id === params.testRequestId);
    if (!request) return notFound();
    advanceRequest(request);
    return HttpResponse.json(request);
  }),

  http.post(`${API}/test-requests/:testRequestId/selection`, async ({ params, request }) => {
    const testRequest = sdb.requests.find((r) => r.id === params.testRequestId);
    if (!testRequest) return notFound();
    if (testRequest.status !== "AWAITING_SELECTION") return invalidState("후보를 고를 수 있는 상태가 아닙니다.");
    const body = await request.json();
    if (!isRecord(body)) return validationProblem([{ field: "body", message: "형식이 올바르지 않습니다." }]);
    const selection =
      typeof body.customText === "string"
        ? { customText: body.customText.trim() }
        : { candidateId: typeof body.candidateId === "string" ? body.candidateId : undefined };
    if (selection.customText !== undefined && !selection.customText) return validationProblem([{ field: "customText", message: "내용을 입력해 주세요." }]);
    const error = selectCandidate(testRequest, selection);
    if (error) return validationProblem([{ field: "candidateId", message: error }]);
    return HttpResponse.json(testRequest, { status: 202 });
  }),

  http.get(`${API}/test-requests/:testRequestId/scenarios`, ({ params }) => {
    const testRequest = sdb.requests.find((r) => r.id === params.testRequestId);
    if (!testRequest) return notFound();
    advanceRequest(testRequest);
    advanceScenarios(testRequest.id);
    return HttpResponse.json(scenarioList(testRequest));
  }),

  http.get(`${API}/scenarios/:scenarioId`, ({ params }) => {
    const scenario = findScenario(params.scenarioId);
    return scenario ? HttpResponse.json(viewScenario(scenario)) : notFound();
  }),

  http.patch(`${API}/scenarios/:scenarioId`, async ({ params, request }) => {
    const scenario = findScenario(params.scenarioId);
    if (!scenario) return notFound();
    if (processing(scenario.status)) return invalidState("시나리오를 만드는 중에는 고칠 수 없습니다.");
    const body = await request.json();
    if (!isRecord(body)) return validationProblem([{ field: "body", message: "형식이 올바르지 않습니다." }]);
    if (typeof body.title === "string") {
      if (!body.title.trim()) return validationProblem([{ field: "title", message: "이름이 필요합니다." }]);
      scenario.title = body.title;
    }
    if (typeof body.requirementRef === "string" || body.requirementRef === null) scenario.requirementRef = body.requirementRef;
    if (Array.isArray(body.scopes)) scenario.scopes = body.scopes.filter((s): s is "UI" | "API" | "DB" => s === "UI" || s === "API" || s === "DB");
    scenario.version += 1;
    scenario.status = "REVIEW_REQUIRED";
    scenario.approvedAt = null;
    return HttpResponse.json(viewScenario(scenario));
  }),

  http.post(`${API}/scenarios/:scenarioId/approve`, ({ params }) => {
    const scenario = findScenario(params.scenarioId);
    if (!scenario) return notFound();
    if (scenario.status !== "REVIEW_REQUIRED") return invalidState("검토 필요 상태에서만 승인할 수 있습니다.");
    scenario.status = "APPROVED";
    scenario.approvedAt = new Date().toISOString();
    return HttpResponse.json(viewScenario(scenario));
  }),

  http.post(`${API}/scenarios/:scenarioId/reject`, ({ params }) => {
    const scenario = findScenario(params.scenarioId);
    if (!scenario) return notFound();
    if (scenario.status !== "REVIEW_REQUIRED") return invalidState("검토 필요 상태에서만 반려할 수 있습니다.");
    scenario.status = "REJECTED";
    return HttpResponse.json(viewScenario(scenario));
  }),

  http.post(`${API}/scenarios/:scenarioId/regenerate`, ({ params }) => {
    const scenario = findScenario(params.scenarioId);
    if (!scenario) return notFound();
    if (!editable.includes(scenario.status)) return invalidState("이미 만들고 있는 시나리오입니다.");
    startRegeneration(scenario);
    return HttpResponse.json(viewScenario(scenario), { status: 202 });
  }),

  http.get(`${API}/test-cases/:testCaseId`, ({ params }) => {
    const testCase = sdb.scenarios.flatMap((s) => s.testCases).find((c) => c.id === params.testCaseId);
    return testCase ? HttpResponse.json(testCase) : notFound();
  }),

  http.patch(`${API}/test-cases/:testCaseId`, async ({ params, request }) => {
    const scenario = sdb.scenarios.find((s) => s.testCases.some((c) => c.id === params.testCaseId));
    const testCase = scenario?.testCases.find((c) => c.id === params.testCaseId);
    if (!scenario || !testCase) return notFound();
    if (processing(scenario.status) || !testCase.isActive) return invalidState("지금은 이 케이스를 고칠 수 없습니다.");
    const body = await request.json();
    if (!isRecord(body)) return validationProblem([{ field: "body", message: "형식이 올바르지 않습니다." }]);
    if (body.expectedValues !== undefined) {
      const errors = checkExpectedValues(body.expectedValues);
      if (errors.length) return validationProblem(errors);
      testCase.expectedValues = toExpectedValues(Array.isArray(body.expectedValues) ? body.expectedValues : []);
    }
    if (typeof body.title === "string") testCase.title = body.title;
    if (typeof body.expectedResult === "string") testCase.expectedResult = body.expectedResult;
    if (body.type === "NORMAL" || body.type === "EXCEPTION" || body.type === "BOUNDARY") testCase.type = body.type;
    if (Array.isArray(body.scopes)) testCase.scopes = body.scopes.filter((s): s is "UI" | "API" | "DB" => s === "UI" || s === "API" || s === "DB");
    if (Array.isArray(body.steps)) testCase.steps = body.steps.map(String);
    if (Array.isArray(body.preconditions)) testCase.preconditions = body.preconditions.map(String);
    testCase.version += 1;
    // 케이스가 바뀌면 시나리오 승인이 풀린다 (FR-03)
    scenario.status = "REVIEW_REQUIRED";
    scenario.approvedAt = null;
    scenario.caseCount = activeCases(scenario).length;
    return HttpResponse.json(testCase);
  }),
];
