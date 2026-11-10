package com.skrr.platform.client.ai;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.JsonNode;

/** ai-api.openapi.yaml 의 Job. result 는 작업 종류별로 해석한다. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record AiJob(String jobId, String type, String status, Progress progress, JsonNode result, Error error) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Progress(String phase, Integer percent, Integer attempt, Integer maxAttempts, String message) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Error(String code, String message, Boolean retryable) {
    }

    public boolean isActive() {
        return "QUEUED".equals(status) || "RUNNING".equals(status);
    }
}
