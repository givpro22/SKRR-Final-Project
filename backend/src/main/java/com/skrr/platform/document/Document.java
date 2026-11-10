package com.skrr.platform.document;

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
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** 기준 문서. 파일 본문은 저장소(S3)에 있고 여기에는 위치와 상태만 둔다. */
@Entity
@Table(name = "document")
public class Document {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private DocumentType type;

    @Column(nullable = false)
    private int version;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    @Column(name = "original_filename", nullable = false, length = 255)
    private String originalFilename;

    @Column(name = "s3_key", nullable = false, length = 1024)
    private String storageKey;

    @Column(name = "content_type", nullable = false, length = 100)
    private String contentType;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "checksum_sha256", nullable = false, length = 64)
    private String checksumSha256;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private DocumentStatus status = DocumentStatus.UPLOADED;

    @Column(name = "index_progress", nullable = false)
    private short indexProgress;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private Map<String, Integer> summary = new LinkedHashMap<>();

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "uploaded_by")
    private UUID uploadedBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Document() {
    }

    public Document(UUID projectId, DocumentType type, int version, String originalFilename, String storageKey,
                    String contentType, long sizeBytes, String checksumSha256, UUID uploadedBy) {
        this.projectId = projectId;
        this.type = type;
        this.version = version;
        this.originalFilename = originalFilename;
        this.storageKey = storageKey;
        this.contentType = contentType;
        this.sizeBytes = sizeBytes;
        this.checksumSha256 = checksumSha256;
        this.uploadedBy = uploadedBy;
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

    /** 상태 변경은 이 메서드로만 한다. 표에 없는 전이는 409 INVALID_STATE_TRANSITION. */
    public void transitionTo(DocumentStatus next) {
        if (!status.canTransitionTo(next)) {
            throw new InvalidStateTransitionException("문서", status, next);
        }
        status = next;
    }

    public void startIndexing() {
        transitionTo(DocumentStatus.INDEXING);
        indexProgress = 0;
        errorMessage = null;
    }

    public void updateIndexProgress(int percent) {
        if (status == DocumentStatus.INDEXING) {
            indexProgress = (short) Math.max(0, Math.min(100, percent));
        }
    }

    public void completeIndexing(Map<String, Integer> newSummary) {
        transitionTo(DocumentStatus.INDEXED);
        indexProgress = 100;
        errorMessage = null;
        if (newSummary != null) {
            summary = new LinkedHashMap<>(newSummary);
        }
    }

    public void failIndexing(String message) {
        transitionTo(DocumentStatus.FAILED);
        errorMessage = message;
    }

    /** 다른 문서의 오류로 이번 구축에서 처리하지 않음 (ADR-020). 파싱까지 끝났으면 요약 수치를 남긴다. */
    public void skipIndexing(String message, Map<String, Integer> parsedSummary) {
        transitionTo(DocumentStatus.SKIPPED);
        errorMessage = message;
        if (parsedSummary != null && !parsedSummary.isEmpty()) {
            summary = new LinkedHashMap<>(parsedSummary);
        }
    }

    /** TEST_DATA 는 인덱싱하지 않고 바로 등록한다. */
    public void register(Map<String, Integer> newSummary) {
        transitionTo(DocumentStatus.REGISTERED);
        summary = new LinkedHashMap<>(newSummary);
    }

    public void deactivate() {
        active = false;
    }

    public UUID getId() {
        return id;
    }

    public UUID getProjectId() {
        return projectId;
    }

    public DocumentType getType() {
        return type;
    }

    public int getVersion() {
        return version;
    }

    public boolean isActive() {
        return active;
    }

    public String getOriginalFilename() {
        return originalFilename;
    }

    public String getStorageKey() {
        return storageKey;
    }

    public String getContentType() {
        return contentType;
    }

    public long getSizeBytes() {
        return sizeBytes;
    }

    public String getChecksumSha256() {
        return checksumSha256;
    }

    public DocumentStatus getStatus() {
        return status;
    }

    public int getIndexProgress() {
        return indexProgress;
    }

    public Map<String, Integer> getSummary() {
        return summary;
    }

    public String getErrorMessage() {
        return errorMessage;
    }

    public UUID getUploadedBy() {
        return uploadedBy;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
