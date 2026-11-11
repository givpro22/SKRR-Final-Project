// 계약 값 → 화면 문구·색. 문구는 harness/context/ui-screens.md "상태 문구"와 state-machines.md Scenario 표를 따른다.
import type { GuardFailureKind, Scenario, ScenarioStatus, TestCaseType, VerificationScope } from "@/api/types";
import type { Tone } from "@/components/Badge";

export const scenarioStatusView: Record<ScenarioStatus, { label: string; tone: Tone }> = {
  APPROVED: { label: "승인", tone: "success" },
  REVIEW_REQUIRED: { label: "검토 필요", tone: "warning" },
  GUARD_RETRY: { label: "가드 재생성", tone: "danger" },
  GENERATING: { label: "생성 중", tone: "accent" },
  REJECTED: { label: "반려", tone: "muted" },
  GUARD_FAILED: { label: "가드 실패", tone: "danger" },
};

export const testCaseTypeView: Record<TestCaseType, { label: string; tone: Tone }> = {
  NORMAL: { label: "정상", tone: "success" },
  EXCEPTION: { label: "예외", tone: "warning" },
  BOUNDARY: { label: "경계", tone: "accent" },
};

export const SCOPE_ORDER = ["UI", "API", "DB"] as const satisfies readonly VerificationScope[];

// 가드 실패 종류 (WBS 4.5.5). 캡처에 없어 계약 enum 설명을 바탕으로 정했다.
export const guardFailureKindLabel: Record<GuardFailureKind, string> = {
  SCHEMA_INVALID: "형식 오류",
  UNKNOWN_REQUIREMENT: "없는 요구사항",
  UNKNOWN_API: "없는 API",
  UNKNOWN_TEST_ID: "없는 화면 요소",
  UNKNOWN_VARIABLE: "없는 변수",
  NO_ASSERTION: "검증 단계 없음",
  MISSING_EXPECTED: "기대값 없음",
  EXPECTED_NOT_APPROVED: "승인되지 않은 기대값",
  CATALOG_GAP: "카탈로그에 없음",
};

/** UI-02-5 범례 순서. 캡처의 승인 · 검토 필요 · 가드 재생성 뒤에 캡처에 없는 상태를 붙인다. */
export const LEGEND = [
  { key: "approved", status: "APPROVED" },
  { key: "reviewRequired", status: "REVIEW_REQUIRED" },
  { key: "guardRetry", status: "GUARD_RETRY" },
  { key: "generating", status: "GENERATING" },
  { key: "rejected", status: "REJECTED" },
  { key: "guardFailed", status: "GUARD_FAILED" },
] as const satisfies readonly { key: string; status: ScenarioStatus }[];

export const legendDotClass: Record<ScenarioStatus, string> = {
  APPROVED: "bg-success",
  REVIEW_REQUIRED: "bg-warning",
  GUARD_RETRY: "bg-danger",
  GENERATING: "bg-accent",
  REJECTED: "bg-muted",
  GUARD_FAILED: "bg-danger",
};

/** "가드 실패: {사유} (N/3회)" (state-machines.md Scenario). GUARD_RETRY·GUARD_FAILED에서만 */
export function guardLine(scenario: Pick<Scenario, "status" | "guard">): string | null {
  const { guard, status } = scenario;
  if (status !== "GUARD_RETRY" && status !== "GUARD_FAILED") return null;
  // 계약상 message에는 접두어가 없다. 생산자가 붙여 보내도 "가드 실패: 가드 실패:"가 되지 않게 한 번 지운다 (QA Q-M2-1)
  const raw = guard.message ?? guard.failures[0]?.message ?? "가드 검증을 통과하지 못했습니다";
  const reason = raw.replace(/^가드 실패:\s*/, "");
  return `가드 실패: ${reason} (${guard.attempt}/${guard.maxAttempts}회)`;
}
