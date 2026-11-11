package com.skrr.platform.client.ai;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/** ai-api.openapi.yaml 의 ScenarioGenerationResult. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record ScenarioGenerationResult(String kind, List<GeneratedScenario> scenarios) {
}
