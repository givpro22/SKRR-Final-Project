import { http, HttpResponse } from "msw";
import type { Problem } from "@/api/types";
import { db } from "./db";
import { problem } from "./handlers";
import { activeRun, cancelRun, createRun, occurred, rdb, screenshotDataUrl, snapshot } from "./runDb";
import { artifactId, buildCaseResult, buildReport, ensureSeed, plainRun, textDataUrl } from "./reportDb";
import { sdb } from "./scenarioDb";

const API = "*/api/v1";
const notFound = () => problem(404, "RESOURCE_NOT_FOUND", "대상 없음", "요청한 대상을 찾을 수 없습니다.");
export const findRun = (id: unknown) => rdb.runs.find((r) => r.initial.id === id);

export const runHandlers = [
  http.post(`${API}/test-requests/:testRequestId/runs`, async ({ params, request }) => {
    ensureSeed();
    const testRequest = sdb.requests.find((r) => r.id === params.testRequestId);
    if (!testRequest) return notFound();
    const body = await request.json();
    const ids = typeof body === "object" && body !== null && "scenarioIds" in body && Array.isArray(body.scenarioIds) ? body.scenarioIds : [];
    const scenarios = sdb.scenarios.filter((s) => ids.includes(s.id));
    if (ids.length === 0 || scenarios.length !== ids.length || scenarios.some((s) => s.testRequestId !== testRequest.id)) {
      const res: Problem = { status: 400, code: "VALIDATION_FAILED", title: "입력값 오류", fieldErrors: [{ field: "scenarioIds", message: "이 요청의 시나리오가 아닙니다." }] };
      return HttpResponse.json(res, { status: 400, headers: { "Content-Type": "application/problem+json" } });
    }
    if (scenarios.some((s) => s.status !== "APPROVED")) return problem(409, "SCENARIO_NOT_APPROVED", "승인 안 됨", "승인되지 않은 시나리오가 있습니다.");
    if (activeRun()) return problem(409, "RUN_ALREADY_ACTIVE", "실행 중", "다른 실행이 진행 중입니다.");
    const project = db.projects.find((p) => p.id === testRequest.projectId);
    if (!project?.targetUrl) return problem(409, "TARGET_URL_MISSING", "대상 사이트 URL 없음", "대상 사이트 URL을 먼저 등록해 주세요.");
    const run = createRun(testRequest.id, scenarios, project.targetUrl);
    const { progress: _p, scenarioRuns: _s, latestScreenshotArtifactId: _l, currentPath: _c, lastEventSeq: _e, ...plain } = run.initial;
    void [_p, _s, _l, _c, _e];
    return HttpResponse.json(plain, { status: 202 });
  }),

  http.get(`${API}/projects/:projectId/runs`, ({ params }) => {
    ensureSeed();
    const items = rdb.runs
      .filter((r) => r.initial.projectId === params.projectId)
      .map((r) => {
        const { progress: _p, scenarioRuns: _s, latestScreenshotArtifactId: _l, currentPath: _c, lastEventSeq: _e, ...plain } = snapshot(r);
        void [_p, _s, _l, _c, _e];
        return plain;
      });
    return HttpResponse.json({ items, nextCursor: null });
  }),

  http.get(`${API}/runs/:runId`, ({ params }) => {
    const run = findRun(params.runId);
    return run ? HttpResponse.json(snapshot(run)) : notFound();
  }),

  http.post(`${API}/runs/:runId/cancel`, ({ params }) => {
    const run = findRun(params.runId);
    if (!run) return notFound();
    const status = snapshot(run).status;
    if (status !== "PREPARING" && status !== "RUNNING") return problem(409, "INVALID_STATE_TRANSITION", "멈출 수 없음", "이미 끝났거나 멈추는 중입니다.");
    cancelRun(run);
    const { progress: _p, scenarioRuns: _s, latestScreenshotArtifactId: _l, currentPath: _c, lastEventSeq: _e, ...plain } = snapshot(run);
    void [_p, _s, _l, _c, _e];
    return HttpResponse.json(plain, { status: 202 });
  }),

  http.get(`${API}/runs/:runId/logs`, ({ params, request }) => {
    const run = findRun(params.runId);
    if (!run) return notFound();
    const url = new URL(request.url);
    const afterSeq = Number(url.searchParams.get("afterSeq") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const logs = occurred(run)
      .filter((e) => e.type === "log" && e.seq > afterSeq)
      .map((e) => ({ seq: e.seq, kind: String(e.data.kind), message: String(e.data.message), occurredAt: String(e.data.occurredAt) }));
    const page = logs.slice(0, limit);
    return HttpResponse.json({ items: page, nextAfterSeq: logs.length > limit ? (page.at(-1)?.seq ?? null) : null });
  }),

  http.get(`${API}/runs/:runId/api-calls`, ({ params }) => {
    const run = findRun(params.runId);
    if (!run) return notFound();
    const calls = occurred(run)
      .filter((e) => e.type === "api.call")
      .map((e) => ({ id: Number(e.data.id), method: String(e.data.method), path: String(e.data.path), statusCode: Number(e.data.statusCode), durationMs: Number(e.data.durationMs), occurredAt: String(e.data.occurredAt) }))
      .reverse();
    const avg = calls.length ? Math.round(calls.reduce((sum, c) => sum + c.durationMs, 0) / calls.length) : null;
    return HttpResponse.json({ items: calls, totalCount: calls.length, averageDurationMs: avg, nextCursor: null });
  }),

  http.get(`${API}/case-results/:caseResultId/spec`, ({ params }) => {
    const run = rdb.runs.find((r) => r.initial.scenarioRuns.some((s) => s.cases.some((c) => c.id === params.caseResultId)));
    const testCase = run?.initial.scenarioRuns.flatMap((s) => s.cases).find((c) => c.id === params.caseResultId);
    if (!run || !testCase || snapshot(run).status === "PREPARING") return notFound();
    const fileName = `${testCase.code.toLowerCase()}.spec.ts`;
    return HttpResponse.json({
      testCaseCode: testCase.code,
      fileName,
      source: `import { test, expect } from "@playwright/test";\n\ntest("${testCase.code} ${testCase.title}", async ({ page, request }) => {\n  await page.goto("/cart");\n  await page.getByTestId("cart-add-button").click();\n  const res = await request.post("/orders", { data: { qty: 3 } });\n  expect(res.status()).toBe(201);\n});\n`,
      rendererVersion: "mock-1",
      compileStatus: "PASSED",
      compileError: null,
    });
  }),

  http.get(`${API}/case-results/:caseResultId`, ({ params }) => {
    ensureSeed();
    const detail = buildCaseResult(String(params.caseResultId));
    return detail ? HttpResponse.json(detail) : notFound();
  }),

  http.get(`${API}/runs/:runId/report`, ({ params }) => {
    ensureSeed();
    const run = findRun(params.runId);
    if (!run) return notFound();
    const status = snapshot(run).status;
    if (!["PASSED", "FAILED", "ERROR", "CANCELLED"].includes(status)) return problem(409, "RUN_NOT_FINISHED", "아직 실행 중", "실행이 끝나야 리포트를 볼 수 있습니다.");
    return HttpResponse.json(buildReport(run));
  }),

  http.post(`${API}/runs/:runId/rerun`, async ({ params, request }) => {
    ensureSeed();
    const run = findRun(params.runId);
    if (!run) return notFound();
    const detail = snapshot(run);
    if (!["PASSED", "FAILED", "ERROR", "CANCELLED"].includes(detail.status)) return problem(409, "RUN_NOT_FINISHED", "아직 실행 중", "실행이 끝나야 다시 실행할 수 있습니다.");
    if (activeRun()) return problem(409, "RUN_ALREADY_ACTIVE", "실행 중", "다른 실행이 진행 중입니다.");
    const body = await request.json().catch(() => ({}));
    const ids = typeof body === "object" && body !== null && "caseResultIds" in body && Array.isArray(body.caseResultIds) ? body.caseResultIds.map(String) : [];
    const cases = detail.scenarioRuns.flatMap((s) => s.cases);
    const targets = ids.length ? cases.filter((c) => ids.includes(c.id)) : cases.filter((c) => c.status === "FAILED");
    if (targets.length === 0 || (ids.length && targets.length !== ids.length)) {
      const res: Problem = { status: 400, code: "VALIDATION_FAILED", title: "입력값 오류", detail: "재실행할 케이스가 없습니다." };
      return HttpResponse.json(res, { status: 400, headers: { "Content-Type": "application/problem+json" } });
    }
    const scenarioIds = new Set(detail.scenarioRuns.filter((s) => s.cases.some((c) => targets.includes(c))).map((s) => s.scenarioId));
    const scenarios = sdb.scenarios.filter((s) => scenarioIds.has(s.id));
    if (scenarios.some((s) => s.status !== "APPROVED")) return problem(409, "SCENARIO_NOT_APPROVED", "승인 안 됨", "승인되지 않은 시나리오가 있습니다.");
    const next = createRun(run.initial.testRequestId, scenarios, run.initial.targetUrl, {
      onlyTestCaseIds: targets.map((c) => c.testCaseId),
      rerunOfRunId: run.initial.id,
      failScenarioIndex: -1,
    });
    return HttpResponse.json(plainRun(next), { status: 202 });
  }),

  http.get(`${API}/artifacts/:artifactId/download-link`, ({ params }) => {
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    for (const run of rdb.runs) {
      const shot = occurred(run).find((e) => e.type === "screenshot" && e.data.artifactId === params.artifactId);
      if (shot) return HttpResponse.json({ url: screenshotDataUrl(String(shot.data.path)), expiresAt });
      for (const c of snapshot(run).scenarioRuns.flatMap((s) => s.cases)) {
        if (params.artifactId === artifactId(c.id, "trace")) return HttpResponse.json({ url: textDataUrl(`mock trace ${c.code}`, "application/zip"), expiresAt });
        if (params.artifactId === artifactId(c.id, "har")) return HttpResponse.json({ url: textDataUrl(`{"log":{"entries":[]}}`, "application/json"), expiresAt });
      }
    }
    return notFound();
  }),
];
