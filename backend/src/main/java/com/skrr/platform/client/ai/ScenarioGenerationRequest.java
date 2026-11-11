package com.skrr.platform.client.ai;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.UUID;

/** ai-api.openapi.yaml 의 ScenarioGenerationRequest. regenerate 는 시나리오 1건 재생성일 때만. */
public record ScenarioGenerationRequest(UUID projectId, String testRequestCode, String requestText,
                                        int firstScenarioNumber, int firstCaseNumber, Regenerate regenerate) {

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Regenerate(String scenarioCode, GeneratedScenario previous, String feedback) {
    }
}
