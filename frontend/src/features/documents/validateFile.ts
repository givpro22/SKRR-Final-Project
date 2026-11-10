import type { DocumentType } from "@/api/types";

// 업로드 전 검사. 서버도 같은 기준으로 413 FILE_TOO_LARGE, 400 UNSUPPORTED_FILE_TYPE을 돌려주므로 둘 다 처리한다.
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ["pdf", "docx", "yaml", "yml", "json", "csv"] as const;
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(",");

// 종류별 허용 형식은 docs/contracts/target-site-contract.md의 문서 형식을 따른다 (백엔드 DocumentType과 같음).
export const extensionsByType: Record<DocumentType, readonly string[]> = {
  REQUIREMENT: ["pdf", "docx"],
  API_SPEC: ["yaml", "yml", "json"],
  CATALOG: ["csv", "json"],
  TEST_DATA: ["json"],
};

export function acceptAttribute(type: DocumentType): string {
  return extensionsByType[type].map((ext) => `.${ext}`).join(",");
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** 문제가 없으면 null, 있으면 사용자에게 보여 줄 문구. type을 주면 그 종류의 허용 형식까지 검사한다. */
export function validateFile(file: Pick<File, "name" | "size">, type?: DocumentType, typeLabel?: string): string | null {
  const ext = fileExtension(file.name);
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
    return `${file.name}: PDF · DOCX · YAML · JSON · CSV 파일만 올릴 수 있습니다.`;
  }
  if (type && !extensionsByType[type].includes(ext)) {
    const allowed = extensionsByType[type].map((e) => e.toUpperCase()).join(", ");
    return `${file.name}: ${typeLabel ?? type}는 ${allowed} 파일만 올릴 수 있습니다.`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `${file.name}: 파일당 20MB 이하만 올릴 수 있습니다.`;
  }
  if (file.size === 0) {
    return `${file.name}: 빈 파일입니다.`;
  }
  return null;
}
