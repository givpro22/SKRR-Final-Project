// 리포트 문구 (ui-screens.md "상태 문구", state-machines.md "실패 원인 분석")
import type { DocumentType, FailureType, SchemaCheckStatus, Severity, Verdict } from "@/api/types";
import type { Tone } from "@/components/Badge";

export const severityView: Record<Severity, { label: string; tone: Tone }> = {
  CRITICAL: { label: "치명", tone: "danger" },
  HIGH: { label: "높음", tone: "danger" },
  MEDIUM: { label: "중간", tone: "warning" },
  LOW: { label: "낮음", tone: "muted" },
};

// DATA_MISMATCH·API_SCHEMA_MISMATCH는 ui-screens.md 표, 나머지는 계약 설명을 바탕으로 정했다
export const failureTypeLabel: Record<FailureType, string> = {
  DATA_MISMATCH: "데이터 불일치",
  API_SCHEMA_MISMATCH: "응답 구조 불일치",
  ASSERTION_FAILED: "기대값 불일치",
  ELEMENT_NOT_FOUND: "화면 요소 없음",
  API_ERROR: "API 오류",
  TIMEOUT: "시간 초과",
  ENVIRONMENT_ERROR: "환경 오류",
  TEST_CODE_ERROR: "테스트 코드 오류",
};

export const verdictView: Record<Verdict, { label: string; tone: Tone }> = {
  MATCH: { label: "일치", tone: "success" },
  MISMATCH: { label: "불일치", tone: "danger" },
  NOT_APPLICABLE: { label: "해당 없음", tone: "muted" },
};

export const schemaCheckLabel: Record<SchemaCheckStatus, string> = {
  PASSED: "구조 일치",
  FAILED: "구조 불일치",
  NOT_CHECKED: "구조 미검사",
};

export const documentShortLabel: Record<DocumentType, string> = {
  REQUIREMENT: "요구사항",
  API_SPEC: "API",
  CATALOG: "카탈로그",
  TEST_DATA: "테스트 데이터",
};

/** 3회 중 일부만 실패하면 불안정 (ADR-016) */
export function isFlaky(attempts: number, failedAttempts: number): boolean {
  return failedAttempts > 0 && failedAttempts < attempts;
}
