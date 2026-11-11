package com.skrr.platform.scenario;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.skrr.platform.document.DocumentType;
import io.swagger.v3.oas.annotations.media.Schema;

/** JSONB 칼럼과 응답에 함께 쓰는 값 형식. 계약 스키마와 이름이 같다. */
public final class JsonValues {

    private JsonValues() {
    }

    /** 계약 RetrievedReference (AI Reference). */
    @Schema(name = "RetrievedReference")
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Reference(DocumentType sourceType, String sourceId, String title, String excerpt, double score) {
    }

    /** 계약 ExpectedValue (ADR-017). expected 와 consistencyOnly(true) 중 하나만 쓴다. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ExpectedValue(String label, String expected, Boolean consistencyOnly, String reason) {

        /** 규칙 위반 사유. 문제없으면 null. */
        public String violation() {
            if (label == null || label.isBlank()) {
                return "label이 비어 있습니다";
            }
            boolean consistency = Boolean.TRUE.equals(consistencyOnly);
            if (consistency && expected != null) {
                return "'" + label + "': expected와 consistencyOnly를 함께 쓸 수 없습니다";
            }
            if (!consistency && expected == null) {
                return "'" + label + "': expected 또는 consistencyOnly(true)가 필요합니다";
            }
            if (consistency && (reason == null || reason.isBlank())) {
                return "'" + label + "': consistencyOnly이면 reason이 필요합니다";
            }
            return null;
        }
    }

    /** 계약 GuardState.failures 항목. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record GuardFailure(GuardFailureKind kind, String message, String subject) {
    }
}
