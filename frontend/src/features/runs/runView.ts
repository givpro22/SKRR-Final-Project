// UI-03 화면 계산 도우미 (컴포넌트 파일과 분리해 빠른 새로고침을 지킨다)
import type { ApiCall, CaseRunSummary, RunDetail, RunProgress, ScenarioRun, StepKind } from "@/api/types";

/** 화면에 그리는 로그 줄 수 (skrr-frontend 규칙) */
export const MAX_LOG_LINES = 1000;

export interface LogLine {
  key: string;
  seq: number | null;
  occurredAt: string;
  kind: StepKind;
  text: string;
  danger?: boolean;
}

export function specFileName(code: string): string {
  return `${code.toLowerCase()}.spec.ts`;
}

export interface ApiCallsState {
  items: ApiCall[];
  totalCount: number;
  averageDurationMs: number | null;
}

/** SSE api.call을 목록과 집계에 더한다. 같은 id는 한 번만 센다 */
export function addApiCall(state: ApiCallsState, call: ApiCall): ApiCallsState {
  if (state.items.some((c) => c.id === call.id)) return state;
  const totalCount = state.totalCount + 1;
  const averageDurationMs =
    call.durationMs == null
      ? state.averageDurationMs
      : Math.round(((state.averageDurationMs ?? call.durationMs) * state.totalCount + call.durationMs) / totalCount);
  return { items: [call, ...state.items].slice(0, 200), totalCount, averageDurationMs };
}

/** 시나리오 카드에서 단계를 보여 줄 케이스: 실행 중인 케이스, 없으면 마지막으로 단계가 있는 케이스 */
export function focusCase(scenario: ScenarioRun): CaseRunSummary | undefined {
  return scenario.cases.find((c) => c.status === "RUNNING") ?? [...scenario.cases].reverse().find((c) => (c.steps?.length ?? 0) > 0);
}

/**
 * 진행 집계를 시나리오 상태에서 다시 센다. 백엔드는 run.status를 실행 시작·끝에만 보내고
 * 시나리오가 바뀔 때는 scenario.status만 보내므로, 받은 progress만 쓰면 중간 집계가 멈춰 보인다.
 */
export function progressOf(run: RunDetail): RunProgress {
  const runs = run.scenarioRuns;
  if (runs.length === 0) return run.progress;
  const count = (status: ScenarioRun["status"]) => runs.filter((s) => s.status === status).length;
  const passed = count("PASSED");
  const failed = count("FAILED");
  const error = count("ERROR");
  const skipped = count("SKIPPED");
  const cancelled = count("CANCELLED");
  const finishedScenarios = passed + failed + error + skipped + cancelled;
  // 시나리오 이벤트보다 실행 집계가 앞서 있으면(예: 끝 상태만 받은 경우) 서버 집계를 쓴다
  if (run.progress.finishedScenarios > finishedScenarios) return run.progress;
  return {
    totalScenarios: runs.length,
    finishedScenarios,
    passed,
    failed,
    error,
    skipped,
    cancelled,
    running: count("RUNNING"),
    waiting: count("WAITING"),
  };
}

/** spec 탭에 보일 케이스: 실행 중인 케이스, 없으면 마지막으로 단계가 있었던 케이스 */
export function specCaseOf(run: RunDetail): CaseRunSummary | null {
  const running = run.scenarioRuns.find((s) => s.status === "RUNNING");
  const current = running && focusCase(running);
  if (current) return current;
  const ordered = [...run.scenarioRuns].sort((a, b) => b.order - a.order);
  for (const scenario of ordered) {
    const last = [...scenario.cases].reverse().find((c) => (c.steps?.length ?? 0) > 0 || c.status !== "PENDING");
    if (last) return last;
  }
  return null;
}

/** 실행기 로그에 섞여 오는 터미널 색 코드(ESC[2m 등)를 지운다 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}
