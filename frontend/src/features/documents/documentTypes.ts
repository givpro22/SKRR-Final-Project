import type { DocumentType } from "@/api/types";

export interface DocumentTypeInfo {
  label: string;
  required: boolean;
  /** 문서가 없을 때 행과 배너에 쓰는 설명 */
  description: string;
  /** 문서가 없을 때 행에 함께 보여 주는 권장 형식 */
  formats: string;
}

// 행 순서와 필수 여부는 UI-01 캡처와 FR-01 기준이다. 실제 누락 판정은 서버의 missingDocumentTypes를 따른다.
export const DOCUMENT_TYPE_ORDER = ["REQUIREMENT", "API_SPEC", "CATALOG", "TEST_DATA"] as const satisfies readonly DocumentType[];

export const documentTypeInfo: Record<DocumentType, DocumentTypeInfo> = {
  REQUIREMENT: {
    label: "요구사항 명세서",
    required: true,
    description: "요구사항 ID(FR-xx)와 수용기준",
    formats: "PDF, DOCX",
  },
  API_SPEC: {
    label: "API 명세서",
    required: true,
    description: "엔드포인트와 DB 확인용 조회 API",
    formats: "YAML, JSON",
  },
  CATALOG: {
    label: "카탈로그",
    required: true,
    description: "화면 요소 · data-testid 목록",
    formats: "CSV, JSON",
  },
  TEST_DATA: {
    label: "테스트 데이터",
    required: false,
    description: "변수 · 비밀값 (seed_accounts.json 형태)",
    formats: "JSON",
  },
};

// Document.summary의 키는 명세에 예시(requirementCount, endpointCount)만 있다. 실제 생산자의 키를 기준으로 한다.
// AI 서버(ai/app/knowledge/models.py): requirementCount, endpointCount, elementCount, pageCount
// 백엔드 TEST_DATA(TestDataSummary.java): variableCount, secretCount
// 모르는 키는 이름 그대로 보인다.
const summaryLabels: Record<string, (n: string) => string> = {
  requirementCount: (n) => `요구사항 ${n}개`,
  endpointCount: (n) => `엔드포인트 ${n}개`,
  elementCount: (n) => `화면 요소 ${n}개`,
  pageCount: (n) => `화면 ${n}개`,
  variableCount: (n) => `변수 ${n}개`,
  secretCount: (n) => `비밀값 ${n}개`,
};

export function summaryParts(summary: Record<string, number>): string[] {
  return Object.entries(summary).map(([key, value]) => {
    const n = value.toLocaleString("ko-KR");
    return summaryLabels[key]?.(n) ?? `${key} ${n}`;
  });
}
