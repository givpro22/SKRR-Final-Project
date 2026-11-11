package com.skrr.platform.client.ai;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.UUID;

/**
 * ai-api.openapi.yaml 의 TestQueryGenerationRequest. availableVariables 는 이름만 (값 없음).
 * queryApiBaseUrl 은 AI 가드가 dbChecks.path 접두를 미리 거르는 데 쓴다 (없으면 생략).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record TestQueryGenerationRequest(UUID projectId, Scenario scenario, GeneratedScenario.GeneratedCase testCase,
                                         List<String> availableVariables, String previousError,
                                         String queryApiBaseUrl) {

    public record Scenario(String code, String title, String requirementRef) {
    }
}
