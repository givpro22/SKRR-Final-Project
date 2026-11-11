package com.skrr.platform.client.runner;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** runner-api.openapi.yaml 스키마 (RenderResult, ExecutionRequest, Execution, StepResult, ApiCallRecord). */
public final class RunnerDtos {

    private RunnerDtos() {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RenderResult(String specSource, String fileName, String rendererVersion, String compileStatus,
                               List<String> compileErrors) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ExecutionRequest(UUID executionId, String baseUrl, Map<String, Object> testQuery,
                                   Map<String, String> secretVariables, Viewport viewport, int timeoutMs) {
    }

    public record Viewport(int width, int height) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record StepResult(String stepId, Integer order, String kind, String title, String status, String detail,
                             String expectedValue, String actualValue, String schemaCheck, List<String> schemaErrors,
                             Integer durationMs) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ApiCallRecord(String method, String path, Integer statusCode, Integer durationMs,
                                String occurredAt) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ArtifactRef(String kind, String name, String contentType, Long sizeBytes, String stepId) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Execution(String executionId, String status, Integer durationMs, String browserVersion,
                            String failureType, String failureMessage, List<StepResult> steps,
                            List<ApiCallRecord> apiCalls, Map<String, String> captures, List<String> consoleErrors,
                            List<ArtifactRef> artifacts) {

        public boolean isTerminal() {
            return status != null && !"QUEUED".equals(status) && !"RUNNING".equals(status);
        }
    }

    /** 실행기 SSE 이벤트 1건. type 은 SSE event 이름, data 는 type 별 객체. */
    public record ExecutionEvent(String type, String occurredAt, com.fasterxml.jackson.databind.JsonNode data) {
    }

    /** 증거 파일 본문. */
    public record ArtifactFile(byte[] content, String contentType) {
    }
}
