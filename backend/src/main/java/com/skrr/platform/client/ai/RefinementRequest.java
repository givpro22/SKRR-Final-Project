package com.skrr.platform.client.ai;

import java.util.UUID;

/** ai-api.openapi.yaml 의 RefinementRequest. */
public record RefinementRequest(UUID projectId, String text, int candidateCount, int topK) {
}
