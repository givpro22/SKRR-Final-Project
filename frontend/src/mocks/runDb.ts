// M3 목: 실행과 SSE 이벤트 대본. 시작 시각 기준으로 "이미 일어난" 이벤트만 스냅샷·로그·API 호출에 반영한다.
// 테스트에서는 frozen으로 시간을 멈춰 스냅샷을 고정하고, 이벤트는 가짜 EventSource로 직접 보낸다.
import type { RunDetail, RunStatus, Scenario } from "@/api/types";
import { applyRunEvent, parseRunEvent, type RunEventType } from "@/features/runs/runEvents";
import { MOCK_PROJECT_ID } from "./db";

export interface ScriptEvent {
  seq: number;
  /** 시작 뒤 몇 ms에 일어나는가 */
  at: number;
  type: Exclude<RunEventType, "heartbeat">;
  data: Record<string, unknown>;
}

export interface MockRun {
  initial: RunDetail;
  startedAtMs: number;
  script: ScriptEvent[];
  /** 미리 만들어 둔 끝난 실행 (테스트에서 시간을 멈춰도 끝난 상태) */
  done?: boolean;
  /** 원인 분석을 조회할 때마다 센다 (분석 중 → 완료) */
  analysisPolls: Map<string, number>;
}

interface RunDb {
  runs: MockRun[];
  seq: number;
  runSeq: number;
  frozen: boolean;
}

function initial(frozen: boolean): RunDb {
  return { runs: [], seq: 0, runSeq: 317, frozen };
}

export let rdb: RunDb = initial(false);

export function resetRunDb(frozen: boolean) {
  rdb = initial(frozen);
}

const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const nextId = () => (rdb.seq += 1);

const STEP_PLAN = [
  { kind: "SETUP", title: "테스트 데이터 초기화" },
  { kind: "UI", title: "장바구니 담기" },
  { kind: "API", title: "주문 API 호출" },
  { kind: "DB", title: "orders 테이블 조회" },
  { kind: "ASSERT", title: "화면·API·DB 교차 검증" },
  { kind: "TEARDOWN", title: "데이터 정리" },
] as const;

const STEP_MS = 250;

export function elapsed(run: MockRun): number {
  if (run.done) return Number.MAX_SAFE_INTEGER;
  return rdb.frozen ? 0 : Date.now() - run.startedAtMs;
}

export function occurred(run: MockRun): ScriptEvent[] {
  const now = elapsed(run);
  return run.script.filter((e) => e.at <= now);
}

/** 이미 일어난 이벤트를 반영한 스냅샷 */
export function snapshot(run: MockRun): RunDetail {
  let detail = run.initial;
  let screenshot: { artifactId: string | null; path: string | null } = {
    artifactId: run.initial.latestScreenshotArtifactId ?? null,
    path: run.initial.currentPath ?? null,
  };
  const events = occurred(run);
  for (const e of events) {
    const parsed = parseRunEvent(e.type, JSON.stringify(e.data));
    if (!parsed) continue;
    if (parsed.type === "screenshot") screenshot = { artifactId: parsed.artifactId, path: parsed.path };
    detail = applyRunEvent(detail, parsed);
  }
  return {
    ...detail,
    latestScreenshotArtifactId: screenshot.artifactId,
    currentPath: screenshot.path,
    lastEventSeq: events.at(-1)?.seq ?? run.initial.lastEventSeq,
  };
}

export function activeRun(): MockRun | undefined {
  return rdb.runs.find((r) => {
    const status = snapshot(r).status;
    return status === "PREPARING" || status === "RUNNING" || status === "CANCELLING";
  });
}

export function createRun(
  testRequestId: string,
  scenarios: Scenario[],
  targetUrl: string,
  options: { failScenarioIndex?: number; onlyTestCaseIds?: string[]; rerunOfRunId?: string } = {},
): MockRun {
  rdb.runSeq += 1;
  const runId = uuid("a9000000", nextId());
  const now = new Date().toISOString();
  const scenarioRuns = scenarios.map((s, i) => ({
    id: uuid("aa000000", nextId()),
    scenarioId: s.id,
    code: s.code,
    title: s.title,
    requirementRef: s.requirementRef ?? null,
    order: i + 1,
    status: "WAITING" as const,
    durationMs: null,
    cases: s.testCases
      .filter((c) => c.isActive && (!options.onlyTestCaseIds || options.onlyTestCaseIds.includes(c.id)))
      .map((c) => ({
        id: uuid("ab000000", nextId()),
        testCaseId: c.id,
        code: c.code,
        title: c.title,
        status: "PENDING" as const,
        attempts: 0,
        failedAttempts: 0,
        durationMs: null,
        steps: [],
      })),
  }));
  const total = scenarioRuns.length;
  const initialDetail: RunDetail = {
    id: runId,
    code: `RUN-${rdb.runSeq.toString().padStart(4, "0")}`,
    projectId: MOCK_PROJECT_ID,
    testRequestId,
    rerunOfRunId: options.rerunOfRunId ?? null,
    status: "PREPARING",
    targetUrl,
    targetBuild: null,
    browser: "Chromium 130",
    viewportWidth: 1280,
    viewportHeight: 800,
    documentVersions: {},
    startedBy: null,
    errorMessage: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    progress: { totalScenarios: total, finishedScenarios: 0, passed: 0, failed: 0, error: 0, skipped: 0, cancelled: 0, running: 0, waiting: total },
    scenarioRuns,
    latestScreenshotArtifactId: null,
    currentPath: null,
    lastEventSeq: 0,
  };
  const run: MockRun = { initial: initialDetail, startedAtMs: Date.now(), script: [], analysisPolls: new Map() };
  run.script = buildScript(run.initial, options.failScenarioIndex ?? 1);
  rdb.runs.unshift(run);
  return run;
}

function buildScript(detail: RunDetail, failScenarioIndex: number): ScriptEvent[] {
  const events: ScriptEvent[] = [];
  let at = 300;
  let seq = 0;
  const push = (type: ScriptEvent["type"], data: Record<string, unknown>, gap = STEP_MS) => {
    seq += 1;
    events.push({ seq, at, type, data: { runId: detail.id, occurredAt: new Date(Date.now() + at).toISOString(), ...data } });
    at += gap;
  };
  const total = detail.scenarioRuns.length;
  const progress = { totalScenarios: total, finishedScenarios: 0, passed: 0, failed: 0, error: 0, skipped: 0, cancelled: 0, running: 0, waiting: total };
  const progressNow = () => ({ ...progress });

  push("run.status", { status: "RUNNING", progress: progressNow() }, 200);
  let apiId = 0;
  detail.scenarioRuns.forEach((sr, sIndex) => {
    progress.waiting -= 1;
    progress.running += 1;
    push("scenario.status", { scenarioRunId: sr.id, code: sr.code, status: "RUNNING" }, 50);
    push("run.status", { status: "RUNNING", progress: progressNow() }, 100);
    // 두 번째 시나리오의 첫 케이스는 교차 검증에서 실패하고 한 번 더 재현한다
    let scenarioFailed = false;
    sr.cases.forEach((c, cIndex) => {
      const fails = sIndex === failScenarioIndex && cIndex === 0;
      const attempts = fails ? 2 : 1;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        push("case.status", { caseResultId: c.id, code: c.code, status: "RUNNING", attempt, failedAttempts: attempt - 1 }, 50);
        const stepIds = STEP_PLAN.map(() => uuid("ac000000", nextId()));
        STEP_PLAN.forEach((step, order) => {
          push("step.status", { caseResultId: c.id, stepId: stepIds[order], order: order + 1, attempt, kind: step.kind, title: step.title, status: "PENDING" }, 0);
        });
        STEP_PLAN.forEach((step, order) => {
          const base = { caseResultId: c.id, stepId: stepIds[order], order: order + 1, attempt, kind: step.kind, title: step.title };
          push("step.status", { ...base, status: "RUNNING" }, STEP_MS);
          if (step.kind === "UI") {
            push("log", { kind: "UI", message: `goto /cart · click [data-testid=cart-add-button] (${c.code})`, caseResultId: c.id }, 50);
            push("screenshot", { artifactId: uuid("ad000000", nextId()), caseResultId: c.id, stepId: base.stepId, path: sIndex % 2 === 0 ? "/cart" : "/checkout" }, 50);
          }
          if (step.kind === "API") {
            apiId += 1;
            push("api.call", { id: apiId, method: "POST", path: "/orders", statusCode: 201, durationMs: 180 + apiId * 7 }, 50);
            push("log", { kind: "API", message: `POST /orders 201 ${180 + apiId * 7}ms`, caseResultId: c.id }, 50);
          }
          if (step.kind === "DB") push("log", { kind: "DB", message: "GET /admin/orders → 조회 1건", caseResultId: c.id }, 50);
          const failed = fails && step.kind === "ASSERT";
          if (step.kind === "ASSERT") {
            push(
              "verification",
              { caseResultId: c.id, itemLabel: "주문 수량", uiValue: "3", apiValue: "3", dbValue: failed ? "2" : "3", verdict: failed ? "MISMATCH" : "MATCH" },
              50,
            );
            // 백엔드처럼 검증 결과 문장을 log로도 보낸다
            push("log", { kind: "ASSERT", message: failed ? "✗ 주문 수량 · UI 3 · API 3 · DB 2 → 불일치" : "✓ 주문 수량 · UI 3 · API 3 · DB 3 → 일치", caseResultId: c.id }, 50);
          }
          push(
            "step.status",
            failed ? { ...base, status: "FAILED", expectedValue: "qty 3", actualValue: "qty 2" } : { ...base, status: "PASSED" },
            100,
          );
        });
        push(
          "case.status",
          { caseResultId: c.id, code: c.code, status: fails ? "FAILED" : "PASSED", attempt, failedAttempts: fails ? attempt : 0 },
          100,
        );
      }
      if (fails) scenarioFailed = true;
    });
    progress.running -= 1;
    progress.finishedScenarios += 1;
    if (scenarioFailed) progress.failed += 1;
    else progress.passed += 1;
    push("scenario.status", { scenarioRunId: sr.id, code: sr.code, status: scenarioFailed ? "FAILED" : "PASSED", durationMs: 4000 + sIndex * 900 }, 50);
    push("run.status", { status: "RUNNING", progress: progressNow() }, 200);
  });
  const finalStatus: RunStatus = progress.failed > 0 ? "FAILED" : "PASSED";
  push("run.status", { status: finalStatus, progress: progressNow() }, 0);
  return events;
}

/** 실행 중단: 남은 대본을 지우고 중단 이벤트로 바꾼다 */
export function cancelRun(run: MockRun) {
  const now = elapsed(run);
  run.script = run.script.filter((e) => e.at <= now);
  let seq = run.script.at(-1)?.seq ?? 0;
  const current = snapshot(run);
  const push = (at: number, type: ScriptEvent["type"], data: Record<string, unknown>) => {
    seq += 1;
    run.script.push({ seq, at, type, data: { runId: run.initial.id, occurredAt: new Date().toISOString(), ...data } });
  };
  push(now, "run.status", { status: "CANCELLING", progress: current.progress });
  const left = current.scenarioRuns.filter((s) => s.status === "WAITING" || s.status === "RUNNING");
  left.forEach((s) => push(now + 600, "scenario.status", { scenarioRunId: s.id, code: s.code, status: "CANCELLED" }));
  push(now + 700, "run.status", {
    status: "CANCELLED",
    progress: {
      ...current.progress,
      running: 0,
      waiting: 0,
      cancelled: current.progress.cancelled + left.length,
      finishedScenarios: current.progress.totalScenarios,
    },
  });
}

/** 현재 화면 목 이미지: 경로 글자를 넣은 SVG */
export function screenshotDataUrl(path: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect width="100%" height="100%" fill="#ffffff"/><rect width="100%" height="56" fill="#F6F6F3"/><text x="40" y="36" font-family="sans-serif" font-size="20" fill="#14161B">목업 쇼핑몰 ${path}</text><text x="40" y="140" font-family="sans-serif" font-size="40" fill="#14161B">${path === "/checkout" ? "주문결제" : "장바구니"}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
