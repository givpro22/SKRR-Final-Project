import type { ExpectedValue } from "@/api/types";

/** 화면에서 고치는 기대값 한 줄. expected와 consistencyOnly는 함께 쓰지 않는다 (ADR-017, ExpectedValue 설명) */
export interface ExpectedValueDraft {
  key: string;
  label: string;
  mode: "value" | "consistency";
  expected: string;
  reason: string;
}

let seq = 0;
const nextKey = () => `ev-${(seq += 1)}`;

export function toDraft(value: ExpectedValue): ExpectedValueDraft {
  return {
    key: nextKey(),
    label: value.label,
    mode: value.consistencyOnly ? "consistency" : "value",
    expected: value.expected ?? "",
    reason: value.reason ?? "",
  };
}

export function emptyDraft(): ExpectedValueDraft {
  return { key: nextKey(), label: "", mode: "value", expected: "", reason: "" };
}

export function toExpectedValue(draft: ExpectedValueDraft): ExpectedValue {
  return draft.mode === "consistency"
    ? { label: draft.label.trim(), consistencyOnly: true, reason: draft.reason.trim() }
    : { label: draft.label.trim(), expected: draft.expected.trim() };
}

/** 줄별 오류 문구. 문제가 없으면 빈 객체 */
export function validateDrafts(drafts: ExpectedValueDraft[]): { list?: string; rows: Record<string, string> } {
  const rows: Record<string, string> = {};
  for (const draft of drafts) {
    if (!draft.label.trim()) rows[draft.key] = "검증 항목을 입력해 주세요.";
    else if (draft.mode === "value" && !draft.expected.trim()) rows[draft.key] = "기대값을 입력해 주세요.";
    else if (draft.mode === "consistency" && !draft.reason.trim())
      rows[draft.key] = "일관성만 확인하는 이유를 입력해 주세요.";
  }
  return { list: drafts.length === 0 ? "기대값을 1개 이상 남겨 주세요." : undefined, rows };
}
