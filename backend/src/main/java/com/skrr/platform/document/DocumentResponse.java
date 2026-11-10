package com.skrr.platform.document;

import io.swagger.v3.oas.annotations.media.Schema;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/** 계약 스키마 Document. */
@Schema(name = "Document")
public record DocumentResponse(
        UUID id,
        UUID projectId,
        DocumentType type,
        int version,
        @JsonProperty("isActive") boolean isActive,
        String originalFilename,
        String contentType,
        long sizeBytes,
        DocumentStatus status,
        int indexProgress,
        Map<String, Integer> summary,
        String errorMessage,
        Instant createdAt) {

    public static DocumentResponse from(Document d) {
        return new DocumentResponse(d.getId(), d.getProjectId(), d.getType(), d.getVersion(), d.isActive(),
                d.getOriginalFilename(), d.getContentType(), d.getSizeBytes(), d.getStatus(), d.getIndexProgress(),
                d.getSummary(), d.getErrorMessage(), d.getCreatedAt());
    }
}
