package com.skrr.platform.run;

import com.skrr.platform.common.error.InvalidStateTransitionException;
import com.skrr.platform.common.time.Times;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** 테스트 실행 (UI-03, UI-04). 표시 코드 RUN-0318 은 프로젝트별 seq. */
@Entity
@Table(name = "test_run")
public class TestRun {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "test_request_id", nullable = false)
    private UUID testRequestId;

    @Column(nullable = false)
    private int seq;

    @Column(name = "rerun_of_run_id")
    private UUID rerunOfRunId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private RunStatus status = RunStatus.PREPARING;

    @Column(name = "target_url", nullable = false, length = 500)
    private String targetUrl;

    @Column(name = "target_build", length = 50)
    private String targetBuild;

    @Column(nullable = false, length = 50)
    private String browser = "Chromium";

    @Column(name = "viewport_width", nullable = false)
    private int viewportWidth = 1280;

    @Column(name = "viewport_height", nullable = false)
    private int viewportHeight = 800;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "document_versions", nullable = false)
    private Map<String, Integer> documentVersions = new LinkedHashMap<>();

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "started_by")
    private UUID startedBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Times.now();

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    protected TestRun() {
    }

    public TestRun(UUID projectId, UUID testRequestId, int seq, String targetUrl, Map<String, Integer> documentVersions,
                   UUID startedBy) {
        this.projectId = projectId;
        this.testRequestId = testRequestId;
        this.seq = seq;
        this.targetUrl = targetUrl;
        this.documentVersions = new LinkedHashMap<>(documentVersions);
        this.startedBy = startedBy;
    }

    /** 재실행 (rerunRun). 원래 실행과 같은 대상·화면 크기로 만든다. */
    public static TestRun rerunOf(TestRun original, int seq, String targetUrl, Map<String, Integer> documentVersions,
                                  UUID startedBy) {
        TestRun run = new TestRun(original.projectId, original.testRequestId, seq, targetUrl, documentVersions,
                startedBy);
        run.rerunOfRunId = original.id;
        run.viewportWidth = original.viewportWidth;
        run.viewportHeight = original.viewportHeight;
        return run;
    }

    public static String codeOf(int seq) {
        return String.format("RUN-%04d", seq);
    }

    public String code() {
        return codeOf(seq);
    }

    /** 상태 변경은 이 메서드로만 한다. 표에 없는 전이는 409 INVALID_STATE_TRANSITION. */
    public void transitionTo(RunStatus next) {
        if (!status.allowedNext().contains(next)) {
            throw new InvalidStateTransitionException("실행", status, next);
        }
        status = next;
        if (next == RunStatus.RUNNING) {
            startedAt = Times.now();
        }
        if (next.isTerminal()) {
            finishedAt = Times.now();
        }
    }

    public void fail(String message) {
        errorMessage = message;
    }

    public void recordBuild(String build) {
        this.targetBuild = build == null || build.isBlank() ? null : build.length() > 50 ? build.substring(0, 50) : build;
    }

    public void recordBrowser(String browserVersion) {
        if (browserVersion != null && !browserVersion.isBlank()) {
            this.browser = browserVersion.length() > 50 ? browserVersion.substring(0, 50) : browserVersion;
        }
    }

    public UUID getId() {
        return id;
    }

    public UUID getProjectId() {
        return projectId;
    }

    public UUID getTestRequestId() {
        return testRequestId;
    }

    public int getSeq() {
        return seq;
    }

    public UUID getRerunOfRunId() {
        return rerunOfRunId;
    }

    public RunStatus getStatus() {
        return status;
    }

    public String getTargetUrl() {
        return targetUrl;
    }

    public String getTargetBuild() {
        return targetBuild;
    }

    public String getBrowser() {
        return browser;
    }

    public int getViewportWidth() {
        return viewportWidth;
    }

    public int getViewportHeight() {
        return viewportHeight;
    }

    public Map<String, Integer> getDocumentVersions() {
        return documentVersions;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public UUID getStartedBy() {
        return startedBy;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public Instant getFinishedAt() {
        return finishedAt;
    }
}
