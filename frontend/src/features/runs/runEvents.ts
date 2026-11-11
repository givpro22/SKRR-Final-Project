// SSE 이벤트(docs/contracts/events.md) 해석과 실행 상태 반영.
// 이벤트 형식은 OpenAPI에 없어 여기서 정의하되, 값 목록은 생성된 enum 타입과 대조한다.
import type {
  CaseResultStatus,
  RunDetail,
  RunProgress,
  RunStatus,
  RunStep,
  ScenarioRunStatus,
  StepKind,
  StepStatus,
  Verdict,
} from "@/api/types";

const RUN_STATUSES = ["PREPARING", "RUNNING", "CANCELLING", "PASSED", "FAILED", "CANCELLED", "ERROR"] as const satisfies readonly RunStatus[];
const SCENARIO_STATUSES = ["WAITING", "RUNNING", "PASSED", "FAILED", "ERROR", "SKIPPED", "CANCELLED"] as const satisfies readonly ScenarioRunStatus[];
const CASE_STATUSES = ["PENDING", "RUNNING", "PASSED", "FAILED", "SKIPPED", "CANCELLED", "ERROR"] as const satisfies readonly CaseResultStatus[];
const STEP_KINDS = ["SETUP", "UI", "API", "DB", "ASSERT", "TEARDOWN"] as const satisfies readonly StepKind[];
const STEP_STATUSES = ["PENDING", "RUNNING", "PASSED", "FAILED", "SKIPPED"] as const satisfies readonly StepStatus[];
const VERDICTS = ["MATCH", "MISMATCH", "NOT_APPLICABLE"] as const satisfies readonly Verdict[];

// 계약 enum과 목록이 어긋나면 컴파일이 실패한다
type Exact<A, B> = [Exclude<A, B>, Exclude<B, A>] extends [never, never] ? true : false;
const enumsComplete: [
  Exact<RunStatus, (typeof RUN_STATUSES)[number]>,
  Exact<ScenarioRunStatus, (typeof SCENARIO_STATUSES)[number]>,
  Exact<CaseResultStatus, (typeof CASE_STATUSES)[number]>,
  Exact<StepKind, (typeof STEP_KINDS)[number]>,
  Exact<StepStatus, (typeof STEP_STATUSES)[number]>,
  Exact<Verdict, (typeof VERDICTS)[number]>,
] = [true, true, true, true, true, true];
void enumsComplete;

export const RUN_EVENT_TYPES = [
  "run.status",
  "scenario.status",
  "case.status",
  "step.status",
  "log",
  "api.call",
  "screenshot",
  "verification",
  "heartbeat",
] as const;
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

export type RunEvent =
  | { type: "run.status"; status: RunStatus; progress: RunProgress | null; errorMessage: string | null }
  | { type: "scenario.status"; scenarioRunId: string; status: ScenarioRunStatus; durationMs: number | null }
  | { type: "case.status"; caseResultId: string; status: CaseResultStatus; attempt: number; failedAttempts: number }
  | ({ type: "step.status"; caseResultId: string } & RunStep)
  | { type: "log"; kind: StepKind; message: string; occurredAt: string }
  | { type: "api.call"; id: number; method: string; path: string; statusCode: number | null; durationMs: number | null; occurredAt: string }
  | { type: "screenshot"; artifactId: string; caseResultId: string | null; path: string | null }
  | {
      type: "verification";
      itemLabel: string;
      uiValue: string | null;
      apiValue: string | null;
      dbValue: string | null;
      verdict: Verdict;
      occurredAt: string;
    }
  | { type: "heartbeat" };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
function oneOf<T extends string>(list: readonly T[], v: unknown): T | null {
  return list.find((item) => item === v) ?? null;
}

function parseProgress(v: unknown): RunProgress | null {
  if (!isObj(v)) return null;
  const n = (key: keyof RunProgress) => num(v[key]);
  const totalScenarios = n("totalScenarios");
  const finishedScenarios = n("finishedScenarios");
  if (totalScenarios === null || finishedScenarios === null) return null;
  return {
    totalScenarios,
    finishedScenarios,
    passed: n("passed") ?? 0,
    failed: n("failed") ?? 0,
    error: n("error") ?? 0,
    skipped: n("skipped") ?? 0,
    cancelled: n("cancelled") ?? 0,
    running: n("running") ?? 0,
    waiting: n("waiting") ?? 0,
  };
}

/** SSE 한 건을 해석한다. 형식이 맞지 않으면 null (무시) */
export function parseRunEvent(type: RunEventType, raw: string): RunEvent | null {
  if (type === "heartbeat") return { type };
  let d: unknown;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(d)) return null;
  const occurredAt = str(d.occurredAt) ?? new Date().toISOString();
  switch (type) {
    case "run.status": {
      const status = oneOf(RUN_STATUSES, d.status);
      return status ? { type, status, progress: parseProgress(d.progress), errorMessage: str(d.errorMessage) } : null;
    }
    case "scenario.status": {
      const status = oneOf(SCENARIO_STATUSES, d.status);
      const scenarioRunId = str(d.scenarioRunId);
      return status && scenarioRunId ? { type, scenarioRunId, status, durationMs: num(d.durationMs) } : null;
    }
    case "case.status": {
      const status = oneOf(CASE_STATUSES, d.status);
      const caseResultId = str(d.caseResultId);
      return status && caseResultId
        ? { type, caseResultId, status, attempt: num(d.attempt) ?? 1, failedAttempts: num(d.failedAttempts) ?? 0 }
        : null;
    }
    case "step.status": {
      const status = oneOf(STEP_STATUSES, d.status);
      const kind = oneOf(STEP_KINDS, d.kind);
      const caseResultId = str(d.caseResultId);
      const id = str(d.stepId);
      const order = num(d.order);
      if (!status || !kind || !caseResultId || !id || order === null) return null;
      return {
        type,
        caseResultId,
        id,
        order,
        attempt: num(d.attempt) ?? 1,
        kind,
        title: str(d.title) ?? "",
        status,
        detail: str(d.detail),
        expectedValue: str(d.expectedValue),
        actualValue: str(d.actualValue),
      };
    }
    case "log": {
      const kind = oneOf(STEP_KINDS, d.kind);
      const message = str(d.message);
      return kind && message !== null ? { type, kind, message, occurredAt } : null;
    }
    case "api.call": {
      const id = num(d.id);
      const method = str(d.method);
      const path = str(d.path);
      return id !== null && method && path
        ? { type, id, method, path, statusCode: num(d.statusCode), durationMs: num(d.durationMs), occurredAt }
        : null;
    }
    case "screenshot": {
      const artifactId = str(d.artifactId);
      return artifactId ? { type, artifactId, caseResultId: str(d.caseResultId), path: str(d.path) } : null;
    }
    case "verification": {
      const verdict = oneOf(VERDICTS, d.verdict);
      const itemLabel = str(d.itemLabel);
      return verdict && itemLabel
        ? { type, itemLabel, uiValue: str(d.uiValue), apiValue: str(d.apiValue), dbValue: str(d.dbValue), verdict, occurredAt }
        : null;
    }
  }
}

/** 실행 상세에 이벤트를 반영한다. 로그·API 호출·화면은 따로 관리한다 */
export function applyRunEvent(run: RunDetail, event: RunEvent): RunDetail {
  switch (event.type) {
    case "run.status":
      return {
        ...run,
        status: event.status,
        progress: event.progress ?? run.progress,
        errorMessage: event.errorMessage ?? run.errorMessage,
        startedAt: run.startedAt ?? (event.status === "RUNNING" ? new Date().toISOString() : null),
      };
    case "scenario.status":
      return {
        ...run,
        scenarioRuns: run.scenarioRuns.map((sr) =>
          sr.id === event.scenarioRunId ? { ...sr, status: event.status, durationMs: event.durationMs ?? sr.durationMs } : sr,
        ),
      };
    case "case.status":
      return mapCase(run, event.caseResultId, (c) => ({
        ...c,
        status: event.status,
        attempts: event.attempt,
        failedAttempts: event.failedAttempts,
      }));
    case "step.status": {
      const { type: _type, caseResultId, ...step } = event;
      void _type;
      return mapCase(run, caseResultId, (c) => {
        const current = c.steps ?? [];
        // 화면은 현재 시도의 단계만 보인다. 새 재현 시도가 시작되면 목록을 바꾸고, 지난 시도의 늦은 이벤트는 버린다
        const latest = Math.max(0, ...current.map((s) => s.attempt));
        if (step.attempt < latest) return c;
        const base = step.attempt > latest ? [] : current;
        const exists = base.some((s) => s.id === step.id);
        const steps = exists ? base.map((s) => (s.id === step.id ? { ...s, ...step } : s)) : [...base, step];
        return { ...c, steps: steps.sort((a, b) => a.order - b.order) };
      });
    }
    default:
      return run;
  }
}

function mapCase(
  run: RunDetail,
  caseResultId: string,
  fn: (c: RunDetail["scenarioRuns"][number]["cases"][number]) => RunDetail["scenarioRuns"][number]["cases"][number],
): RunDetail {
  return {
    ...run,
    scenarioRuns: run.scenarioRuns.map((sr) =>
      sr.cases.some((c) => c.id === caseResultId) ? { ...sr, cases: sr.cases.map((c) => (c.id === caseResultId ? fn(c) : c)) } : sr,
    ),
  };
}
