package com.skrr.platform.project;

import com.skrr.platform.common.time.Times;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "activity_log")
public class ActivityLog {

    static final int MAX_MESSAGE_LENGTH = 300;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(nullable = false, length = MAX_MESSAGE_LENGTH)
    private String message;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected ActivityLog() {
    }

    public ActivityLog(UUID projectId, String message) {
        this.projectId = projectId;
        this.message = message.length() > MAX_MESSAGE_LENGTH ? message.substring(0, MAX_MESSAGE_LENGTH) : message;
        this.createdAt = Times.now();
    }

    public Long getId() {
        return id;
    }

    public UUID getProjectId() {
        return projectId;
    }

    public String getMessage() {
        return message;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
