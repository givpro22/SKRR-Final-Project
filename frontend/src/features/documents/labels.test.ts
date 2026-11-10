import { describe, expect, it } from "vitest";
import { parseProblem } from "@/api/errors";
import { formatBytes } from "@/lib/format";
import { withObjectParticle } from "@/lib/korean";
import { summaryParts } from "./documentTypes";
import { documentStatusView, knowledgeBaseStatusView, targetStatusView } from "./statusLabels";
import { MAX_FILE_BYTES, validateFile } from "./validateFile";

describe("문서 상태 표시", () => {
  it("state-machines.md의 문구와 색을 따른다", () => {
    expect(documentStatusView("INDEXED", 100)).toEqual({ label: "인덱싱 완료", tone: "success" });
    expect(documentStatusView("INDEXING", 68)).toEqual({ label: "인덱싱 중 68%", tone: "accent" });
    expect(documentStatusView("REGISTERED", 0)).toEqual({ label: "등록됨", tone: "success" });
    expect(documentStatusView("FAILED", 40)).toEqual({ label: "인덱싱 실패", tone: "danger" });
    expect(documentStatusView("SKIPPED", 0)).toEqual({ label: "건너뜀", tone: "warning" });
    expect(documentStatusView("UPLOADED", 0)).toEqual({ label: "구축 대기", tone: "muted" });
  });

  it("지식 베이스와 대상 사이트 상태를 모두 표시한다", () => {
    expect(Object.keys(knowledgeBaseStatusView).sort()).toEqual(["BUILDING", "FAILED", "NOT_BUILT", "READY", "STALE"]);
    expect(targetStatusView.REACHABLE.label).toBe("연결 확인");
  });
});

describe("업로드 전 파일 검사", () => {
  it("허용 형식과 20MB 이하만 통과시킨다", () => {
    expect(validateFile({ name: "spec.YAML", size: 1024 })).toBeNull();
    expect(validateFile({ name: "image.png", size: 1024 })).toMatch("PDF · DOCX · YAML · JSON · CSV");
    expect(validateFile({ name: "big.pdf", size: MAX_FILE_BYTES + 1 })).toMatch("20MB");
    expect(validateFile({ name: "ok.pdf", size: MAX_FILE_BYTES })).toBeNull();
    expect(validateFile({ name: "empty.csv", size: 0 })).toMatch("빈 파일");
  });

  it("문서 종류별 허용 형식을 검사한다 (target-site-contract.md)", () => {
    expect(validateFile({ name: "req.pdf", size: 10 }, "REQUIREMENT")).toBeNull();
    expect(validateFile({ name: "req.csv", size: 10 }, "REQUIREMENT", "요구사항 명세서")).toBe("req.csv: 요구사항 명세서는 PDF, DOCX 파일만 올릴 수 있습니다.");
    expect(validateFile({ name: "seed.csv", size: 10 }, "TEST_DATA")).toMatch("JSON 파일만");
    expect(validateFile({ name: "catalog.csv", size: 10 }, "CATALOG")).toBeNull();
  });
});

describe("표시 형식", () => {
  it("파일 크기", () => {
    expect(formatBytes(2_516_582)).toBe("2.4MB");
    expect(formatBytes(184_320)).toBe("180KB");
    expect(formatBytes(512)).toBe("512B");
  });

  it("요약 수치", () => {
    expect(summaryParts({ requirementCount: 42 })).toEqual(["요구사항 42개"]);
    expect(summaryParts({ variableCount: 12, secretCount: 3 })).toEqual(["변수 12개", "비밀값 3개"]);
    expect(summaryParts({ elementCount: 24, pageCount: 3 })).toEqual(["화면 요소 24개", "화면 3개"]);
    expect(summaryParts({ unknownKey: 3 })).toEqual(["unknownKey 3"]);
  });

  it("목적격 조사", () => {
    expect(withObjectParticle("카탈로그")).toBe("카탈로그를");
    expect(withObjectParticle("요구사항 목록")).toBe("요구사항 목록을");
  });
});

describe("Problem 응답 해석", () => {
  it("계약의 ErrorCode만 받아들인다", () => {
    expect(parseProblem({ title: "t", status: 409, code: "MISSING_REQUIRED_DOCUMENTS" })?.code).toBe("MISSING_REQUIRED_DOCUMENTS");
    expect(parseProblem({ title: "t", status: 409, code: "SOMETHING_ELSE" })).toBeNull();
    expect(
      parseProblem({ title: "t", status: 400, code: "VALIDATION_FAILED", fieldErrors: [{ field: "targetUrl", message: "m" }, { bad: 1 }] })
        ?.fieldErrors,
    ).toEqual([{ field: "targetUrl", message: "m" }]);
    const missing = parseProblem({ title: "t", status: 409, code: "MISSING_REQUIRED_DOCUMENTS", missingDocumentTypes: ["CATALOG", "NOPE"], instance: "/x" });
    expect(missing?.missingDocumentTypes).toEqual(["CATALOG"]);
    expect(missing?.instance).toBe("/x");
    expect(parseProblem({ title: "t", status: 400, code: "UNSUPPORTED_FILE_TYPE", allowedExtensions: ["csv", 1] })?.allowedExtensions).toEqual(["csv"]);
  });
});

describe("요약 수치 (인덱싱 전·실패)", () => {
  it("summary가 비어 있으면 아무것도 덧붙이지 않는다", () => {
    expect(summaryParts({})).toEqual([]);
  });
});
