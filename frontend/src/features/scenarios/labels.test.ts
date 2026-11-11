import { describe, expect, it } from "vitest";
import type { GuardState } from "@/api/types";
import { requestStatusView } from "@/features/requests/labels";
import { toExpectedValue, validateDrafts } from "./expectedValues";
import { guardLine, LEGEND, scenarioStatusView, testCaseTypeView } from "./labels";

describe("시나리오 상태 문구", () => {
  it("ui-screens.md 상태 문구 표와 같다", () => {
    expect(Object.fromEntries(Object.entries(scenarioStatusView).map(([k, v]) => [k, v.label]))).toEqual({
      APPROVED: "승인",
      REVIEW_REQUIRED: "검토 필요",
      GUARD_RETRY: "가드 재생성",
      GENERATING: "생성 중",
      REJECTED: "반려",
      GUARD_FAILED: "가드 실패",
    });
    expect(testCaseTypeView.NORMAL.label).toBe("정상");
    expect(testCaseTypeView.EXCEPTION.label).toBe("예외");
    expect(testCaseTypeView.BOUNDARY.label).toBe("경계");
    expect(LEGEND.map((l) => l.status).sort()).toEqual(Object.keys(scenarioStatusView).sort());
    expect(Object.keys(requestStatusView).sort()).toEqual(["AWAITING_SELECTION", "FAILED", "GENERATED", "GENERATING", "REFINING"]);
  });

  it("가드 문구는 사유와 N/3회를 붙인다", () => {
    const guard: GuardState = { attempt: 2, maxAttempts: 3, message: "카탈로그에 'x' 요소가 없어 재생성 중", catalogGap: false, failures: [] };
    expect(guardLine({ status: "GUARD_RETRY", guard })).toBe("가드 실패: 카탈로그에 'x' 요소가 없어 재생성 중 (2/3회)");
    expect(guardLine({ status: "APPROVED", guard })).toBeNull();
    expect(guardLine({ status: "GUARD_RETRY", guard: { ...guard, message: "가드 실패: 중복 접두어" } })).toBe("가드 실패: 중복 접두어 (2/3회)");
  });
});

describe("기대값 편집", () => {
  it("값 지정과 일관성만은 서로 다른 필드로 보낸다 (ADR-017)", () => {
    expect(toExpectedValue({ key: "a", label: " 수량 ", mode: "value", expected: " 3 ", reason: "x" })).toEqual({ label: "수량", expected: "3" });
    expect(toExpectedValue({ key: "b", label: "ID", mode: "consistency", expected: "1", reason: " 매번 다름 " })).toEqual({
      label: "ID",
      consistencyOnly: true,
      reason: "매번 다름",
    });
  });

  it("빈 항목과 이유 없는 일관성만 항목을 막는다", () => {
    const result = validateDrafts([
      { key: "a", label: "", mode: "value", expected: "1", reason: "" },
      { key: "b", label: "수량", mode: "value", expected: "", reason: "" },
      { key: "c", label: "ID", mode: "consistency", expected: "", reason: "" },
      { key: "d", label: "금액", mode: "value", expected: "1000", reason: "" },
    ]);
    expect(Object.keys(result.rows)).toEqual(["a", "b", "c"]);
    expect(validateDrafts([]).list).toBe("기대값을 1개 이상 남겨 주세요.");
  });
});
