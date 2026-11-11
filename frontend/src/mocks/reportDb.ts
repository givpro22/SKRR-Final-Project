// M4 목: 끝난 실행의 리포트·케이스 상세를 실행 대본에서 만든다. 미리 끝난 실행 2개(RUN-0316, RUN-0317)를 둔다.
import type { ArtifactRef, CaseResultDetail, Run, RunDetail, RunReport, RunStep, Verification } from "@/api/types";
import { createRun, occurred, rdb, snapshot, type MockRun } from "./runDb";
import { MOCK_REQUEST_ID, sdb } from "./scenarioDb";

let seeded = false;

export function resetReportSeed() {
  seeded = false;
}

/** 승인된 시나리오 SC-01~04로 끝난 실행 2개를 만든다. 앞 실행은 TC-01, 뒤 실행은 TC-07이 실패한다 */
export function ensureSeed() {
  if (seeded) return;
  seeded = true;
  const scenarios = sdb.scenarios.filter((s) => s.testRequestId === MOCK_REQUEST_ID && s.status === "APPROVED");
  if (scenarios.length === 0) return;
  const target = "https://shop-mock.skrr.dev";
  const saveSeq = rdb.runSeq;
  rdb.runSeq = 315;
  const older = createRun(MOCK_REQUEST_ID, scenarios, target, { failScenarioIndex: 0 });
  const newer = createRun(MOCK_REQUEST_ID, scenarios, target, { failScenarioIndex: 1 });
  rdb.runSeq = Math.max(saveSeq, 317);
  const hour = 3600_000;
  for (const [run, ago] of [[older, 26 * hour], [newer, 2 * hour]] as const) {
    run.done = true;
    run.startedAtMs = Date.now() - ago;
    run.initial = { ...run.initial, createdAt: new Date(run.startedAtMs).toISOString(), startedAt: new Date(run.startedAtMs + 300).toISOString() };
  }
  // createRun은 앞에 넣는다. 미리 만든 실행은 새로 시작하는 실행보다 뒤에 두기 위해 끝으로 옮긴다
  rdb.runs = [...rdb.runs.filter((r) => r !== older && r !== newer), newer, older];
}

export function plainRun(run: MockRun): Run {
  const snap = snapshot(run);
  const { progress: _p, scenarioRuns: _s, latestScreenshotArtifactId: _l, currentPath: _c, lastEventSeq: _e, ...plain } = snap;
  void [_p, _s, _l, _c, _e];
  const last = run.script.at(-1);
  const finished = ["PASSED", "FAILED", "ERROR", "CANCELLED"].includes(plain.status);
  return {
    ...plain,
    startedAt: plain.startedAt ?? new Date(run.startedAtMs + 300).toISOString(),
    finishedAt: finished && last ? new Date(run.startedAtMs + last.at).toISOString() : null,
    targetBuild: "a3f9c21",
    documentVersions: { REQUIREMENT: 3, API_SPEC: 2, CATALOG: 2 },
    startedBy: { id: "0b6e3f0e-2f7c-4f1d-9a51-3e4d5c6b7a01", displayName: "박영서", roleLabel: "QA 담당자" },
  };
}

function caseEvents(run: MockRun, caseResultId: string) {
  return occurred(run).filter((e) => e.data.caseResultId === caseResultId);
}

function lastAttempt(run: MockRun, caseResultId: string): number {
  return Math.max(1, ...caseEvents(run, caseResultId).filter((e) => e.type === "case.status").map((e) => Number(e.data.attempt)));
}

function stepsOf(run: MockRun, caseResultId: string): RunStep[] {
  const attempt = lastAttempt(run, caseResultId);
  const steps = new Map<string, RunStep>();
  for (const e of caseEvents(run, caseResultId)) {
    if (e.type !== "step.status" || Number(e.data.attempt) !== attempt) continue;
    const kind = String(e.data.kind);
    steps.set(String(e.data.stepId), {
      id: String(e.data.stepId),
      order: Number(e.data.order),
      attempt,
      kind: kind === "SETUP" || kind === "UI" || kind === "API" || kind === "DB" || kind === "ASSERT" || kind === "TEARDOWN" ? kind : "UI",
      title: String(e.data.title),
      status: e.data.status === "PASSED" || e.data.status === "FAILED" || e.data.status === "RUNNING" || e.data.status === "SKIPPED" ? e.data.status : "PENDING",
      detail: kind === "API" ? "POST /orders 201" : null,
      expectedValue: typeof e.data.expectedValue === "string" ? e.data.expectedValue : null,
      actualValue: typeof e.data.actualValue === "string" ? e.data.actualValue : kind === "UI" ? "장바구니 수량 3" : kind === "API" ? "POST /orders 201" : null,
      schemaCheck: kind === "API" ? "PASSED" : null,
    });
  }
  return [...steps.values()].sort((a, b) => a.order - b.order);
}

function verificationsOf(run: MockRun, caseResultId: string): Verification[] {
  const attempt = lastAttempt(run, caseResultId);
  const all = caseEvents(run, caseResultId).filter((e) => e.type === "verification");
  const mine = all.slice(-1); // 시도마다 1개, 마지막 시도 것
  void attempt;
  return mine.map((e, i) => ({
    order: i + 1,
    itemLabel: String(e.data.itemLabel),
    uiValue: String(e.data.uiValue),
    apiValue: String(e.data.apiValue),
    dbValue: String(e.data.dbValue),
    expectedValue: "3",
    verdict: e.data.verdict === "MISMATCH" ? "MISMATCH" : "MATCH",
  }));
}

function previousRun(run: MockRun): MockRun | undefined {
  if (run.initial.rerunOfRunId) return rdb.runs.find((r) => r.initial.id === run.initial.rerunOfRunId);
  const finished = ["PASSED", "FAILED", "ERROR"];
  return rdb.runs
    .filter((r) => r !== run && r.initial.testRequestId === run.initial.testRequestId && r.startedAtMs < run.startedAtMs && finished.includes(snapshot(r).status))
    .sort((a, b) => b.startedAtMs - a.startedAtMs)[0];
}

function caseStatusByTestCase(detail: RunDetail): Map<string, string> {
  return new Map(detail.scenarioRuns.flatMap((s) => s.cases.map((c) => [c.testCaseId, c.status] as const)));
}

export function buildReport(run: MockRun): RunReport {
  const detail = snapshot(run);
  const scenarios = detail.scenarioRuns.map((s) => ({
    scenarioRunId: s.id,
    code: s.code,
    title: s.title,
    requirementRef: s.requirementRef ?? null,
    status: s.status,
    durationMs: s.durationMs ?? null,
    passedCases: s.cases.filter((c) => c.status === "PASSED").length,
    totalCases: s.cases.length,
    cases: s.cases.map((c) => ({ caseResultId: c.id, code: c.code, title: c.title, status: c.status, attempts: c.attempts, failedAttempts: c.failedAttempts, durationMs: 3200 * Math.max(1, c.attempts) })),
  }));
  const cases = scenarios.flatMap((s) => s.cases);
  const casesPassed = cases.filter((c) => c.status === "PASSED").length;
  const rate = (detailOf: RunDetail) => {
    const all = detailOf.scenarioRuns.flatMap((s) => s.cases);
    return all.length ? Math.round((all.filter((c) => c.status === "PASSED").length / all.length) * 100) : 0;
  };
  const prev = previousRun(run);
  const prevDetail = prev ? snapshot(prev) : null;
  const prevStatus = prevDetail ? caseStatusByTestCase(prevDetail) : new Map<string, string>();
  const nowCases = detail.scenarioRuns.flatMap((s) => s.cases);
  const included = new Set(detail.scenarioRuns.map((s) => s.scenarioId));
  const last = run.script.at(-1);
  return {
    run: plainRun(run),
    kpis: {
      scenariosPassed: scenarios.filter((s) => s.status === "PASSED").length,
      scenariosTotal: scenarios.length,
      casesPassed,
      casesTotal: cases.length,
      casePassRatePct: rate(detail),
      failedCases: cases.filter((c) => c.status === "FAILED").length,
      errorCases: cases.filter((c) => c.status === "ERROR").length,
      crossCheckMismatches: occurred(run).filter((e) => e.type === "verification" && e.data.verdict === "MISMATCH").length,
      durationMs: last ? last.at : 0,
      apiCallCount: occurred(run).filter((e) => e.type === "api.call").length,
    },
    scenarios,
    skippedScenarios: sdb.scenarios
      .filter((s) => s.testRequestId === run.initial.testRequestId && !included.has(s.id))
      .map((s) => ({ code: s.code, status: s.status })),
    comparison: prev
      ? {
          previousRunCode: prev.initial.code,
          newFailures: nowCases.filter((c) => c.status === "FAILED" && prevStatus.get(c.testCaseId) !== "FAILED").map((c) => c.code),
          continuingFailures: nowCases.filter((c) => c.status === "FAILED" && prevStatus.get(c.testCaseId) === "FAILED").map((c) => c.code),
          resolved: nowCases.filter((c) => c.status === "PASSED" && prevStatus.get(c.testCaseId) === "FAILED").map((c) => c.code),
          previousCasePassRatePct: prevDetail ? rate(prevDetail) : null,
        }
      : { previousRunCode: null, newFailures: [], continuingFailures: [], resolved: [], previousCasePassRatePct: null },
  };
}

export function findCase(caseResultId: string) {
  for (const run of rdb.runs) {
    for (const s of snapshot(run).scenarioRuns) {
      const c = s.cases.find((x) => x.id === caseResultId);
      if (c) return { run, scenario: s, item: c };
    }
  }
  return null;
}

export function artifactId(caseResultId: string, kind: "trace" | "har"): string {
  return `${kind === "trace" ? "ae" : "af"}${caseResultId.slice(2)}`;
}

export function buildCaseResult(caseResultId: string): CaseResultDetail | null {
  const found = findCase(caseResultId);
  if (!found) return null;
  const { run, scenario, item } = found;
  const failed = item.status === "FAILED";
  const polls = (run.analysisPolls.get(caseResultId) ?? 0) + 1;
  run.analysisPolls.set(caseResultId, polls);
  // 미리 만든 최신 실행의 실패 케이스는 처음 두 번 조회까지 분석 중으로 보인다
  const analyzing = failed && run.done && run.initial.code === "RUN-0317" && polls <= 2;
  const prev = previousRun(run);
  const prevFailed = prev ? snapshot(prev).scenarioRuns.flatMap((s) => s.cases).some((c) => c.testCaseId === item.testCaseId && c.status === "FAILED") : false;
  const finishedAt = run.startedAtMs + (run.script.at(-1)?.at ?? 0);
  const artifacts: ArtifactRef[] = [
    ...caseEvents(run, caseResultId)
      .filter((e) => e.type === "screenshot")
      .slice(-1)
      .map((e) => ({ id: String(e.data.artifactId), type: "SCREENSHOT" as const, label: "실패 시점 화면", sizeBytes: 182_000, createdAt: new Date(run.startedAtMs + e.at).toISOString() })),
    ...(item.status === "PENDING" ? [] : [
      { id: artifactId(caseResultId, "trace"), type: "TRACE" as const, label: "trace.zip", sizeBytes: 1_240_000, createdAt: new Date(finishedAt).toISOString() },
      { id: artifactId(caseResultId, "har"), type: "HAR" as const, label: "network.har", sizeBytes: 86_000, createdAt: new Date(finishedAt).toISOString() },
    ]),
  ];
  return {
    id: item.id,
    code: item.code,
    title: item.title,
    scenarioCode: scenario.code,
    scenarioTitle: scenario.title,
    requirementRef: scenario.requirementRef ?? null,
    status: item.status,
    attempts: item.attempts,
    failedAttempts: item.failedAttempts,
    durationMs: 3200 * Math.max(1, item.attempts),
    severity: failed && !analyzing ? "HIGH" : null,
    failureType: failed ? "DATA_MISMATCH" : null,
    failureMessage: failed ? "주문 수량: DB 값 2가 기대값 3과 다릅니다" : null,
    analysisStatus: !failed ? "NOT_REQUIRED" : analyzing ? "RUNNING" : "COMPLETED",
    analysisError: null,
    affectedFeatures: failed && !analyzing ? ["장바구니", "결제"] : [],
    firstSeenRunCode: failed ? (prevFailed && prev ? prev.initial.code : run.initial.code) : null,
    verifications: verificationsOf(run, caseResultId),
    reproductionSteps: stepsOf(run, caseResultId),
    rootCauses:
      failed && !analyzing
        ? [
            {
              rank: 1,
              description: "`POST /orders`가 장바구니 수량을 합산하지 않고 덮어씀",
              confidencePct: 82,
              evidence: ["POST /orders 요청 qty=3, 응답 뒤 orders.qty=2 (기존값 유지)"],
              remediation: "OrderService.create()에서 같은 상품의 수량을 합산하도록 수정",
            },
            { rank: 2, description: "주문 생성 시 캐시된 장바구니 스냅샷 사용", confidencePct: 11, evidence: ["주문 직전 GET /cart 응답 qty=3"], remediation: null },
            { rank: 3, description: "화면 수량 배지가 로컬 상태만 반영", confidencePct: 7, evidence: ["화면 수량 3"], remediation: null },
          ]
        : [],
    artifacts,
  };
}

export function textDataUrl(text: string, type = "application/octet-stream"): string {
  return `data:${type};charset=utf-8,${encodeURIComponent(text)}`;
}

export { createRun };
