package com.skrr.platform.client.ai;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.Map;

/** ai-api.openapi.yaml 의 TestQueryGenerationResult. testQuery 는 그대로 보관해 실행기에 넘긴다. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record TestQueryGenerationResult(String kind, Map<String, Object> testQuery, GeneratedScenario.Guard guard) {
}
