package com.skrr.platform.run;

import com.skrr.platform.common.time.Times;
import com.skrr.platform.run.RunEnums.ArtifactType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** 실행 증거 위치. 파일 본문은 저장소(run-artifacts/...)에 있다 (ADR-023 U1). */
@Entity
@Table(name = "artifact")
public class Artifact {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "run_id", nullable = false)
    private UUID runId;

    @Column(name = "case_result_id")
    private UUID caseResultId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ArtifactType type;

    @Column(name = "s3_key", nullable = false, length = 1024)
    private String storageKey;

    @Column(name = "content_type", nullable = false, length = 100)
    private String contentType;

    @Column(name = "size_bytes")
    private Long sizeBytes;

    @Column(length = 200)
    private String label;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Times.now();

    protected Artifact() {
    }

    public Artifact(UUID runId, UUID caseResultId, ArtifactType type, String storageKey, String contentType,
                    long sizeBytes, String label) {
        this.runId = runId;
        this.caseResultId = caseResultId;
        this.type = type;
        this.storageKey = storageKey;
        this.contentType = contentType;
        this.sizeBytes = sizeBytes;
        this.label = label == null ? null : label.length() > 200 ? label.substring(0, 200) : label;
    }

    public UUID getId() {
        return id;
    }

    public UUID getRunId() {
        return runId;
    }

    public UUID getCaseResultId() {
        return caseResultId;
    }

    public ArtifactType getType() {
        return type;
    }

    public String getStorageKey() {
        return storageKey;
    }

    public String getContentType() {
        return contentType;
    }

    public Long getSizeBytes() {
        return sizeBytes;
    }

    public String getLabel() {
        return label;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
