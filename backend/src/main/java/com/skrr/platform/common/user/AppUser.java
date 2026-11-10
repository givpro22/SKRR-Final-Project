package com.skrr.platform.common.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "app_user")
public class AppUser {

    @Id
    private UUID id;

    @Column(name = "display_name", nullable = false, length = 100)
    private String displayName;

    @Column(name = "role_label", nullable = false, length = 50)
    private String roleLabel;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected AppUser() {
    }

    public UUID getId() {
        return id;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getRoleLabel() {
        return roleLabel;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
