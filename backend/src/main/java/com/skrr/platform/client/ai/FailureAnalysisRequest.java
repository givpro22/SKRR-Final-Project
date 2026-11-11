package com.skrr.platform.client.ai;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.UUID;

/** ai-api.openapi.yaml 의 FailureAnalysisRequest. FAILED 케이스만, 비밀값 없이 보낸다. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record FailureAnalysisRequest(UUID projectId, String caseCode, String caseTitle, String requirementRef,
                                     String expectedResult, String failureType, String failureMessage, int attempts,
                                     int failedAttempts, List<Step> steps, List<ApiCall> apiCalls,
                                     List<Verification> verifications, List<String> consoleErrors,
                                     String specSource) {

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Step(int order, String kind, String title, String status, String detail, String expectedValue,
                       String actualValue, String schemaCheck) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ApiCall(String method, String path, Integer statusCode, Integer durationMs) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Verification(String itemLabel, String uiValue, String apiValue, String dbValue,
                               String expectedValue, String verdict) {
    }
}
