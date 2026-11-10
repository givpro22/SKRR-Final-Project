package com.skrr.platform.client.ai;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** ai-api.openapi.yaml 의 KnowledgeBaseBuildResult. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record KnowledgeBaseBuildResult(String kind, int chunkCount, int requirementCount, int apiCount,
                                       int uiElementCount, List<DocumentResult> documents) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record DocumentResult(UUID documentId, String status, Map<String, Integer> summary, String error) {
    }
}
