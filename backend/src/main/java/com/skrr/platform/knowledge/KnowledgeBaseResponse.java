package com.skrr.platform.knowledge;

import io.swagger.v3.oas.annotations.media.Schema;
import com.skrr.platform.document.DocumentType;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 계약 스키마 KnowledgeBase. readiness 는 UI-01 "등록 요건" 체크리스트다. */
@Schema(name = "KnowledgeBase")
public record KnowledgeBaseResponse(
        UUID projectId,
        KnowledgeBaseStatus status,
        int chunkCount,
        int requirementCount,
        int apiCount,
        int uiElementCount,
        Instant lastSyncedAt,
        String errorMessage,
        List<ReadinessItem> readiness,
        List<DocumentType> missingDocumentTypes,
        boolean canBuild) {

    public record ReadinessItem(String key, String label, boolean satisfied) {
    }
}
