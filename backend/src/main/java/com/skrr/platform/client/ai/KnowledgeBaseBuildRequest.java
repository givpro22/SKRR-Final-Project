package com.skrr.platform.client.ai;

import java.util.List;
import java.util.UUID;

/** ai-api.openapi.yaml 의 KnowledgeBaseBuildRequest. */
public record KnowledgeBaseBuildRequest(List<Document> documents) {

    public record Document(UUID documentId, String type, int version, String s3Key, String contentType,
                           String checksumSha256) {
    }
}
