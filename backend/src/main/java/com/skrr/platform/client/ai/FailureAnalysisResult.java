package com.skrr.platform.client.ai;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/** ai-api.openapi.yaml 의 FailureAnalysisResult. failureType 은 돌려주지 않는다(백엔드 규칙). */
@JsonIgnoreProperties(ignoreUnknown = true)
public record FailureAnalysisResult(String kind, String severity, List<String> affectedFeatures,
                                    List<RootCause> rootCauses) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RootCause(Integer rank, String description, Integer confidencePct, List<String> evidence,
                            String remediation) {
    }
}
