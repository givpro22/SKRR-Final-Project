package com.skrr.platform.run;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** 실시간 이벤트 저장소. SSE 재연결(Last-Event-ID)과 로그 조회가 함께 쓴다. seq 가 SSE id 다. */
@Entity
@Table(name = "run_event")
public class RunEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long seq;

    @Column(name = "run_id", nullable = false)
    private UUID runId;

    @Column(nullable = false, length = 30)
    private String type;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private Map<String, Object> payload;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected RunEvent() {
    }

    public RunEvent(UUID runId, String type, Map<String, Object> payload, Instant createdAt) {
        this.runId = runId;
        this.type = type;
        this.payload = payload;
        this.createdAt = createdAt;
    }

    public Long getSeq() {
        return seq;
    }

    public UUID getRunId() {
        return runId;
    }

    public String getType() {
        return type;
    }

    public Map<String, Object> getPayload() {
        return payload;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
