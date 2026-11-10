import type { DocumentType, ErrorCode, Problem } from "./types";

// 런타임 검사용 목록. 명세의 ErrorCode와 어긋나면 아래 타입 검사가 실패한다.
const ERROR_CODES = [
  "VALIDATION_FAILED",
  "RESOURCE_NOT_FOUND",
  "FILE_TOO_LARGE",
  "UNSUPPORTED_FILE_TYPE",
  "TARGET_URL_MISSING",
  "MISSING_REQUIRED_DOCUMENTS",
  "KNOWLEDGE_BASE_NOT_READY",
  "INVALID_STATE_TRANSITION",
  "SCENARIO_NOT_APPROVED",
  "RUN_NOT_FINISHED",
  "RUN_ALREADY_ACTIVE",
  "DEPENDENCY_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const satisfies readonly ErrorCode[];

type Missing = Exclude<ErrorCode, (typeof ERROR_CODES)[number]>;
const allCodesListed: Missing extends never ? true : Missing = true;
void allCodesListed;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toFieldErrors(value: unknown): Problem["fieldErrors"] {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) =>
    isRecord(item) && typeof item.field === "string" && typeof item.message === "string"
      ? [{ field: item.field, message: item.message }]
      : [],
  );
}

const DOCUMENT_TYPES = ["REQUIREMENT", "API_SPEC", "CATALOG", "TEST_DATA"] as const satisfies readonly DocumentType[];

function toDocumentTypes(value: unknown): DocumentType[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => DOCUMENT_TYPES.filter((type) => type === item));
}

function toStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

/** 응답 본문을 Problem으로 읽는다. 형식이 다르면 null. */
export function parseProblem(body: unknown): Problem | null {
  if (!isRecord(body)) return null;
  const { title, status, code, detail, type, instance } = body;
  if (typeof title !== "string" || typeof status !== "number" || !isErrorCode(code)) return null;
  return {
    title,
    status,
    code,
    detail: typeof detail === "string" ? detail : undefined,
    type: typeof type === "string" ? type : undefined,
    instance: typeof instance === "string" ? instance : undefined,
    missingDocumentTypes: toDocumentTypes(body.missingDocumentTypes),
    allowedExtensions: toStrings(body.allowedExtensions),
    fieldErrors: toFieldErrors(body.fieldErrors),
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem | null;

  constructor(status: number, problem: Problem | null) {
    super(problem?.detail ?? problem?.title ?? `요청을 처리하지 못했습니다 (HTTP ${status})`);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }

  get code(): ErrorCode | undefined {
    return this.problem?.code;
  }

  fieldError(field: string): string | undefined {
    return this.problem?.fieldErrors?.find((e) => e.field === field)?.message;
  }
}

export function hasErrorCode(error: unknown, code: ErrorCode): error is ApiError {
  return error instanceof ApiError && error.code === code;
}

/** 화면에 보여 줄 오류 문구. 서버 detail을 우선한다. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return "서버에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.";
  if (error instanceof Error) return error.message;
  return "알 수 없는 오류가 발생했습니다.";
}
