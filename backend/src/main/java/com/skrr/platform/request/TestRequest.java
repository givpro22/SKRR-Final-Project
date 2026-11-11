package com.skrr.platform.request;

import com.skrr.platform.common.error.InvalidStateTransitionException;
import com.skrr.platform.common.time.Times;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** 자연어 테스트 요청 (UI-02-1, UI-02-1B, FR-02). 표시 코드 REQ-0142 는 프로젝트별 seq 로 만든다. */
@Entity
@Table(name = "test_request")
public class TestRequest {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(nullable = false)
    private int seq;

    @Column(name = "raw_text", nullable = false, length = 500)
    private String rawText;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private TestRequestStatus status = TestRequestStatus.REFINING;

    @Enumerated(EnumType.STRING)
    @Column(name = "selection_source", length = 20)
    private SelectionSource selectionSource;

    @Column(name = "selected_text")
    private String selectedText;

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "created_by")
    private UUID createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected TestRequest() {
    }

    public TestRequest(UUID projectId, int seq, String rawText, UUID createdBy) {
        this.projectId = projectId;
        this.seq = seq;
        this.rawText = rawText;
        this.createdBy = createdBy;
    }

    @PrePersist
    void onCreate() {
        createdAt = Times.now();
        updatedAt = createdAt;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Times.now();
    }

    public static String codeOf(int seq) {
        return String.format("REQ-%04d", seq);
    }

    public String code() {
        return codeOf(seq);
    }

    /** 상태 변경은 이 메서드로만 한다. 표에 없는 전이는 409 INVALID_STATE_TRANSITION. */
    public void transitionTo(TestRequestStatus next) {
        if (!status.canTransitionTo(next)) {
            throw new InvalidStateTransitionException("테스트 요청", status, next);
        }
        status = next;
    }

    public void candidatesReady() {
        transitionTo(TestRequestStatus.AWAITING_SELECTION);
        errorMessage = null;
    }

    public void select(SelectionSource source, String text) {
        transitionTo(TestRequestStatus.GENERATING);
        selectionSource = source;
        selectedText = text;
    }

    public void generated() {
        transitionTo(TestRequestStatus.GENERATED);
        errorMessage = null;
    }

    public void fail(String message) {
        transitionTo(TestRequestStatus.FAILED);
        errorMessage = message;
    }

    public UUID getId() {
        return id;
    }

    public UUID getProjectId() {
        return projectId;
    }

    public int getSeq() {
        return seq;
    }

    public String getRawText() {
        return rawText;
    }

    public TestRequestStatus getStatus() {
        return status;
    }

    public SelectionSource getSelectionSource() {
        return selectionSource;
    }

    public String getSelectedText() {
        return selectedText;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public UUID getCreatedBy() {
        return createdBy;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
