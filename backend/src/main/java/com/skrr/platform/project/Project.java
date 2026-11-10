package com.skrr.platform.project;

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
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "project")
public class Project {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(name = "target_url", length = 500)
    private String targetUrl;

    @Enumerated(EnumType.STRING)
    @Column(name = "target_url_status", nullable = false, length = 20)
    private TargetUrlStatus targetUrlStatus = TargetUrlStatus.UNVERIFIED;

    @Column(name = "target_checked_at")
    private Instant targetCheckedAt;

    /** 마지막 연결 확인에서 대상 서버가 돌려준 HTTP 상태 코드. 응답이 없었으면 null (ADR-019). */
    @Column(name = "target_check_status_code")
    private Short targetCheckStatusCode;

    /** 마지막 연결 확인 결과 문장. UNREACHABLE이면 실패 사유. */
    @Column(name = "target_check_message")
    private String targetCheckMessage;

    @Column(name = "query_api_base_url", length = 500)
    private String queryApiBaseUrl;

    @Column(name = "test_control_url", length = 500)
    private String testControlUrl;

    @Column(name = "created_by")
    private UUID createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Project() {
    }

    public Project(String name, UUID createdBy) {
        this.name = name;
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

    public void rename(String newName) {
        this.name = newName;
    }

    /** 대상 URL이 바뀌면 확인 결과를 버리고 UNVERIFIED로 돌린다 (updateProject 계약). */
    public boolean changeTargetUrl(String newUrl) {
        if (Objects.equals(targetUrl, newUrl)) {
            return false;
        }
        this.targetUrl = newUrl;
        this.targetUrlStatus = TargetUrlStatus.UNVERIFIED;
        this.targetCheckedAt = null;
        this.targetCheckStatusCode = null;
        this.targetCheckMessage = null;
        return true;
    }

    public void changeQueryApiBaseUrl(String url) {
        this.queryApiBaseUrl = url;
    }

    public void changeTestControlUrl(String url) {
        this.testControlUrl = url;
    }

    public void recordTargetCheck(boolean reachable, Integer statusCode, String message, Instant checkedAt) {
        this.targetUrlStatus = reachable ? TargetUrlStatus.REACHABLE : TargetUrlStatus.UNREACHABLE;
        this.targetCheckStatusCode = statusCode == null ? null : statusCode.shortValue();
        this.targetCheckMessage = message;
        this.targetCheckedAt = checkedAt;
    }

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getTargetUrl() {
        return targetUrl;
    }

    public TargetUrlStatus getTargetUrlStatus() {
        return targetUrlStatus;
    }

    public Instant getTargetCheckedAt() {
        return targetCheckedAt;
    }

    public Integer getTargetCheckStatusCode() {
        return targetCheckStatusCode == null ? null : targetCheckStatusCode.intValue();
    }

    public String getTargetCheckMessage() {
        return targetCheckMessage;
    }

    public String getQueryApiBaseUrl() {
        return queryApiBaseUrl;
    }

    public String getTestControlUrl() {
        return testControlUrl;
    }

    public UUID getCreatedBy() {
        return createdBy;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
