/** docs/contracts/schemas/test-query.schema.json 형식 (실행기가 쓰는 부분). 검증은 schema.ts가 한다. */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface Base {
  id: string;
  description: string;
}

export type Step =
  | (Base & { action: "goto"; path: string })
  | (Base & { action: "click"; testId: string })
  | (Base & { action: "fill" | "selectOption"; testId: string; value: string })
  | (Base & { action: "expectVisible"; testId: string; visible?: boolean })
  | (Base & { action: "expectText"; testId: string; text: string; match?: "EXACT" | "CONTAINS" })
  | (Base & { action: "expectCount"; testId: string; count: number })
  | (Base & { action: "press"; testId: string; key: string })
  | (Base & { action: "expectUrl"; path: string; match?: "EXACT" | "PREFIX" })
  | (Base & { action: "captureText"; testId: string; as: string })
  | (Base & ({ action: "waitForApi"; trigger: string } | { action: "apiRequest"; headers?: Record<string, string>; body?: unknown }) & ApiCheck & {
      method: HttpMethod;
      path: string;
    })
  | (Base & { action: "expectCapture"; capture: string; equals: string });

export interface ApiCheck {
  expectStatus?: number;
  captures?: Record<string, string>;
  specOperation?: string;
  responseSchema?: Record<string, unknown>;
}

export interface TestQuery {
  schemaVersion: "1.0";
  testCaseCode: string;
  title: string;
  variables?: Record<string, string>;
  secretCaptures?: string[];
  steps: Step[];
  dbChecks?: unknown[];
  crossChecks?: unknown[];
}

export type StepKind = "SETUP" | "UI" | "API" | "DB" | "ASSERT" | "TEARDOWN";
export type StepStatus = "PENDING" | "RUNNING" | "PASSED" | "FAILED" | "SKIPPED";
export type ExecutionStatus = "QUEUED" | "RUNNING" | "PASSED" | "FAILED" | "ERROR" | "CANCELLED";
export type FailureType =
  | "DATA_MISMATCH"
  | "ASSERTION_FAILED"
  | "ELEMENT_NOT_FOUND"
  | "API_ERROR"
  | "API_SCHEMA_MISMATCH"
  | "TIMEOUT"
  | "ENVIRONMENT_ERROR"
  | "TEST_CODE_ERROR";

/** API 단계는 API, 나머지는 UI (contract-architect C1 메모) */
export function stepKind(step: Step): StepKind {
  return step.action === "apiRequest" || step.action === "waitForApi" ? "API" : "UI";
}

export interface StepResult {
  stepId: string;
  order: number;
  kind: StepKind;
  title: string;
  status: StepStatus;
  detail?: string;
  expectedValue?: string;
  actualValue?: string;
  schemaCheck?: "PASSED" | "FAILED" | "NOT_CHECKED";
  schemaErrors?: string[];
  durationMs?: number;
}

export interface ApiCallRecord {
  method: string;
  path: string;
  statusCode?: number;
  durationMs?: number;
  occurredAt?: string;
}
