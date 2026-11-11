package com.skrr.platform.run;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** 실행 중 관찰한 API 호출 (UI-03 "API 호출" 패널). */
@Entity
@Table(name = "api_call")
public class ApiCallEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "run_id", nullable = false)
    private UUID runId;

    @Column(name = "case_result_id")
    private UUID caseResultId;

    @Column(nullable = false, length = 10)
    private String method;

    @Column(nullable = false, length = 1000)
    private String path;

    @Column(name = "status_code")
    private Short statusCode;

    @Column(name = "duration_ms")
    private Integer durationMs;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    protected ApiCallEntry() {
    }

    public ApiCallEntry(UUID runId, UUID caseResultId, String method, String path, Integer statusCode,
                        Integer durationMs, Instant occurredAt) {
        this.runId = runId;
        this.caseResultId = caseResultId;
        this.method = method.length() > 10 ? method.substring(0, 10) : method;
        this.path = path.length() > 1000 ? path.substring(0, 1000) : path;
        this.statusCode = statusCode == null ? null : statusCode.shortValue();
        this.durationMs = durationMs;
        this.occurredAt = occurredAt;
    }

    public Long getId() {
        return id;
    }

    public UUID getRunId() {
        return runId;
    }

    public String getMethod() {
        return method;
    }

    public String getPath() {
        return path;
    }

    public Integer getStatusCode() {
        return statusCode == null ? null : statusCode.intValue();
    }

    public Integer getDurationMs() {
        return durationMs;
    }

    public Instant getOccurredAt() {
        return occurredAt;
    }
}
