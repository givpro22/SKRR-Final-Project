// 실행 관련 상태 문구 (harness/context/ui-screens.md "상태 문구")
import type { CaseResultStatus, RunStatus, ScenarioRunStatus, StepKind, Verdict } from "@/api/types";
import type { Tone } from "@/components/Badge";

export const scenarioRunStatusView: Record<ScenarioRunStatus, { label: string; tone: Tone }> = {
  PASSED: { label: "통과", tone: "success" },
  FAILED: { label: "실패", tone: "danger" },
  ERROR: { label: "실행 오류", tone: "warning" },
  RUNNING: { label: "실행 중", tone: "accent" },
  WAITING: { label: "대기", tone: "muted" },
  SKIPPED: { label: "건너뜀", tone: "muted" },
  CANCELLED: { label: "중단됨", tone: "muted" },
};

export const caseStatusLabel: Record<CaseResultStatus, string> = {
  PENDING: "대기",
  RUNNING: "실행 중",
  PASSED: "통과",
  FAILED: "실패",
  ERROR: "실행 오류",
  SKIPPED: "건너뜀",
  CANCELLED: "중단됨",
};

/** 헤더 제목. 캡처는 실행 중("테스트 실행 중")만 있다 */
export const runTitle: Record<RunStatus, string> = {
  PREPARING: "테스트 실행 준비 중",
  RUNNING: "테스트 실행 중",
  CANCELLING: "실행을 멈추는 중",
  PASSED: "테스트 실행 완료 · 통과",
  FAILED: "테스트 실행 완료 · 실패 있음",
  CANCELLED: "테스트 실행 중단됨",
  ERROR: "테스트 실행 오류",
};

export const runStatusBadge: Record<RunStatus, { label: string; tone: Tone }> = {
  PREPARING: { label: "준비 중", tone: "accent" },
  RUNNING: { label: "LIVE", tone: "accent" },
  CANCELLING: { label: "중단 중", tone: "warning" },
  PASSED: { label: "통과", tone: "success" },
  FAILED: { label: "실패", tone: "danger" },
  CANCELLED: { label: "중단됨", tone: "muted" },
  ERROR: { label: "실행 오류", tone: "warning" },
};

/** 로그 라벨 색 (캡처: API 주황, UI 파랑, ASSERT 초록, DB 보라) */
export const logKindClass: Record<StepKind, string> = {
  API: "text-log-api",
  UI: "text-log-ui",
  ASSERT: "text-log-assert",
  DB: "text-log-db",
  SETUP: "text-log-muted",
  TEARDOWN: "text-log-muted",
};

export const verdictLabel: Record<Verdict, string> = {
  MATCH: "일치",
  MISMATCH: "불일치",
  NOT_APPLICABLE: "해당 없음",
};

/**
 * 진행 막대·범례. 캡처는 통과·실패·실행 중·대기 4개이며, 실행 오류·건너뜀·중단됨은 0이 아닐 때만 보인다.
 * 끝난 상태끼리 앞에 모아 첫 줄에서 보이게 한다 (QA Q-M3-9: 대상 사이트가 꺼져 건너뜀이 생긴 실행).
 * 범례 수의 합은 totalScenarios와 같다.
 */
export const PROGRESS_SEGMENTS = [
  { key: "passed", label: "통과", bar: "bg-success", always: true },
  { key: "failed", label: "실패", bar: "bg-danger", always: true },
  { key: "error", label: "실행 오류", bar: "bg-warning", always: false },
  { key: "skipped", label: "건너뜀", bar: "bg-line-strong", always: false },
  { key: "cancelled", label: "중단됨", bar: "bg-line-strong", always: false },
  { key: "running", label: "실행 중", bar: "bg-accent", always: true },
  { key: "waiting", label: "대기", bar: "bg-muted", always: true },
] as const;

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "";
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatElapsed(fromIso: string | null | undefined, now: number): string {
  if (!fromIso) return "00:00";
  const sec = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
