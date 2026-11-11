package com.skrr.platform.run;

import com.skrr.platform.common.error.InvalidStateTransitionException;
import com.skrr.platform.run.RunEnums.AnalysisStatus;
import com.skrr.platform.run.RunEnums.FailureType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** 케이스 1건의 실행 결과. 재현 시도(attempt)를 모두 합친 판정이다. */
@Entity
@Table(name = "case_result")
public class CaseResult {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "scenario_run_id", nullable = false)
    private UUID scenarioRunId;

    @Column(name = "test_case_id", nullable = false)
    private UUID testCaseId;

    @Column(name = "generated_spec_id")
    private UUID generatedSpecId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private CaseResultStatus status = CaseResultStatus.PENDING;

    @Column(nullable = false)
    private short attempts;

    @Column(name = "failed_attempts", nullable = false)
    private short failedAttempts;

    @Column(name = "duration_ms")
    private Long durationMs;

    @Column(length = 20)
    private String severity;

    @Enumerated(EnumType.STRING)
    @Column(name = "failure_type", length = 30)
    private FailureType failureType;

    @Column(name = "failure_message")
    private String failureMessage;

    @Column(name = "failure_fingerprint", length = 64)
    private String failureFingerprint;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "affected_features", nullable = false, columnDefinition = "text[]")
    private String[] affectedFeatures = new String[0];

    @Column(name = "first_seen_run_id")
    private UUID firstSeenRunId;

    @Enumerated(EnumType.STRING)
    @Column(name = "analysis_status", nullable = false, length = 20)
    private AnalysisStatus analysisStatus = AnalysisStatus.NOT_REQUIRED;

    @Column(name = "analysis_error")
    private String analysisError;

    protected CaseResult() {
    }

    public CaseResult(UUID scenarioRunId, UUID testCaseId) {
        this.scenarioRunId = scenarioRunId;
        this.testCaseId = testCaseId;
    }

    public void transitionTo(CaseResultStatus next) {
        if (!status.allowedNext().contains(next)) {
            throw new InvalidStateTransitionException("케이스 실행", status, next);
        }
        status = next;
    }

    public void useSpec(UUID specId) {
        this.generatedSpecId = specId;
    }

    /** 준비(TestQuery 생성) 단계 실패. 시나리오를 실행할 때 RUNNING → ERROR 로 끝낸다. */
    public void markPreparationFailure(FailureType type, String message) {
        this.failureType = type;
        this.failureMessage = message;
    }

    public boolean hasPreparationFailure() {
        return generatedSpecId == null && failureType != null;
    }

    public void recordAttempt(boolean failed) {
        attempts++;
        if (failed) {
            failedAttempts++;
        }
    }

    public void finish(CaseResultStatus next, FailureType type, String message, long duration) {
        transitionTo(next);
        this.failureType = type;
        this.failureMessage = message;
        this.durationMs = duration;
    }

    /** AnalysisStatus 전이: NOT_REQUIRED → PENDING → RUNNING → COMPLETED | FAILED (state-machines.md 실패 원인 분석). */
    public void requestAnalysis() {
        if (analysisStatus == AnalysisStatus.NOT_REQUIRED && status == CaseResultStatus.FAILED) {
            analysisStatus = AnalysisStatus.PENDING;
            analysisError = null;
        }
    }

    public void analysisStarted() {
        if (analysisStatus == AnalysisStatus.PENDING) {
            analysisStatus = AnalysisStatus.RUNNING;
        }
    }

    public void analysisCompleted(String newSeverity, java.util.List<String> features) {
        if (analysisStatus == AnalysisStatus.PENDING || analysisStatus == AnalysisStatus.RUNNING) {
            analysisStatus = AnalysisStatus.COMPLETED;
            severity = newSeverity;
            affectedFeatures = features == null ? new String[0] : features.toArray(String[]::new);
            analysisError = null;
        }
    }

    public void analysisFailed(String message) {
        if (analysisStatus == AnalysisStatus.PENDING || analysisStatus == AnalysisStatus.RUNNING) {
            analysisStatus = AnalysisStatus.FAILED;
            analysisError = message;
        }
    }

    public void recordFingerprint(String fingerprint, UUID firstSeen) {
        this.failureFingerprint = fingerprint;
        this.firstSeenRunId = firstSeen;
    }

    public String getSeverity() {
        return severity;
    }

    public java.util.List<String> getAffectedFeatures() {
        return java.util.Arrays.asList(affectedFeatures);
    }

    public String getFailureFingerprint() {
        return failureFingerprint;
    }

    public UUID getFirstSeenRunId() {
        return firstSeenRunId;
    }

    public String getAnalysisError() {
        return analysisError;
    }

    public UUID getId() {
        return id;
    }

    public UUID getScenarioRunId() {
        return scenarioRunId;
    }

    public UUID getTestCaseId() {
        return testCaseId;
    }

    public UUID getGeneratedSpecId() {
        return generatedSpecId;
    }

    public CaseResultStatus getStatus() {
        return status;
    }

    public int getAttempts() {
        return attempts;
    }

    public int getFailedAttempts() {
        return failedAttempts;
    }

    public Long getDurationMs() {
        return durationMs;
    }

    public FailureType getFailureType() {
        return failureType;
    }

    public String getFailureMessage() {
        return failureMessage;
    }

    public AnalysisStatus getAnalysisStatus() {
        return analysisStatus;
    }
}
