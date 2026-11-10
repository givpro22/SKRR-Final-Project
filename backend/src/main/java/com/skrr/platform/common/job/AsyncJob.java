package com.skrr.platform.common.job;

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

/**
 * AI 서버 비동기 작업 추적. 백엔드가 재시작해도 열린 작업을 이어서 조회한다.
 * attempt 는 AI 서버에 작업을 보낸 횟수다 (처음 1, 작업 유실·재시도 가능 오류로 다시 보내면 2).
 */
@Entity
@Table(name = "async_job")
public class AsyncJob {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private JobType type;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private JobStatus status = JobStatus.QUEUED;

    @Column(name = "remote_job_id", length = 100)
    private String remoteJobId;

    @Column(name = "subject_type", nullable = false, length = 30)
    private String subjectType;

    @Column(name = "subject_id", nullable = false)
    private UUID subjectId;

    @Column(nullable = false)
    private short attempt = 1;

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected AsyncJob() {
    }

    public AsyncJob(JobType type, String subjectType, UUID subjectId) {
        this.type = type;
        this.subjectType = subjectType;
        this.subjectId = subjectId;
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

    private void transitionTo(JobStatus next) {
        if (!status.allowedNext().contains(next)) {
            throw new InvalidStateTransitionException("비동기 작업", status, next);
        }
        status = next;
    }

    public void submitted(String remoteId) {
        this.remoteJobId = remoteId;
        if (status != JobStatus.RUNNING) {
            transitionTo(JobStatus.RUNNING);
        }
    }

    /** 다시 보낼 준비. 원격 작업 ID를 지우고 attempt 를 올린다. */
    public void requeue() {
        transitionTo(JobStatus.QUEUED);
        remoteJobId = null;
        attempt++;
    }

    public void succeed() {
        transitionTo(JobStatus.SUCCEEDED);
        errorMessage = null;
    }

    public void fail(String message) {
        transitionTo(JobStatus.FAILED);
        errorMessage = message;
    }

    public void cancel(String message) {
        transitionTo(JobStatus.CANCELLED);
        errorMessage = message;
    }

    public UUID getId() {
        return id;
    }

    public JobType getType() {
        return type;
    }

    public JobStatus getStatus() {
        return status;
    }

    public String getRemoteJobId() {
        return remoteJobId;
    }

    public String getSubjectType() {
        return subjectType;
    }

    public UUID getSubjectId() {
        return subjectId;
    }

    public int getAttempt() {
        return attempt;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
