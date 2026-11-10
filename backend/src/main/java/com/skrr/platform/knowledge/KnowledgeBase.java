package com.skrr.platform.knowledge;

import com.skrr.platform.common.error.InvalidStateTransitionException;
import com.skrr.platform.common.time.Times;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** RAG 지식 베이스 상태와 통계. 벡터는 AI 서버의 sqlite-vec 파일에 있다. */
@Entity
@Table(name = "knowledge_base")
public class KnowledgeBase {

    @Id
    @Column(name = "project_id")
    private UUID projectId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private KnowledgeBaseStatus status = KnowledgeBaseStatus.NOT_BUILT;

    @Column(name = "chunk_count", nullable = false)
    private int chunkCount;

    @Column(name = "requirement_count", nullable = false)
    private int requirementCount;

    @Column(name = "api_count", nullable = false)
    private int apiCount;

    @Column(name = "ui_element_count", nullable = false)
    private int uiElementCount;

    @Column(name = "last_synced_at")
    private Instant lastSyncedAt;

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected KnowledgeBase() {
    }

    public KnowledgeBase(UUID projectId) {
        this.projectId = projectId;
    }

    @PrePersist
    @PreUpdate
    void touch() {
        updatedAt = Times.now();
    }

    /** 상태 변경은 이 메서드로만 한다. 표에 없는 전이는 409 INVALID_STATE_TRANSITION. */
    public void transitionTo(KnowledgeBaseStatus next) {
        if (!status.canTransitionTo(next)) {
            throw new InvalidStateTransitionException("지식 베이스", status, next);
        }
        status = next;
    }

    public void startBuild() {
        transitionTo(KnowledgeBaseStatus.BUILDING);
        errorMessage = null;
    }

    public void completeBuild(int chunks, int requirements, int apis, int uiElements, Instant syncedAt) {
        transitionTo(KnowledgeBaseStatus.READY);
        chunkCount = chunks;
        requirementCount = requirements;
        apiCount = apis;
        uiElementCount = uiElements;
        lastSyncedAt = syncedAt;
        errorMessage = null;
    }

    public void failBuild(String message) {
        transitionTo(KnowledgeBaseStatus.FAILED);
        errorMessage = message;
    }

    /** 활성 문서가 바뀌면 READY → STALE. 다른 상태에서는 그대로 둔다. */
    public boolean markStaleIfReady() {
        if (status == KnowledgeBaseStatus.READY) {
            transitionTo(KnowledgeBaseStatus.STALE);
            return true;
        }
        return false;
    }

    public UUID getProjectId() {
        return projectId;
    }

    public KnowledgeBaseStatus getStatus() {
        return status;
    }

    public int getChunkCount() {
        return chunkCount;
    }

    public int getRequirementCount() {
        return requirementCount;
    }

    public int getApiCount() {
        return apiCount;
    }

    public int getUiElementCount() {
        return uiElementCount;
    }

    public Instant getLastSyncedAt() {
        return lastSyncedAt;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
