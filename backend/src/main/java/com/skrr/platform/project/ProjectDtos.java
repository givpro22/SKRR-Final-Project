package com.skrr.platform.project;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.validator.constraints.URL;

/** 계약 스키마 Project, ProjectCreate, ProjectUpdate, TargetVerification, Activity. */
public final class ProjectDtos {

    private static final String HTTP_URL = "^https?://.+";
    private static final String HTTP_URL_MESSAGE = "http 또는 https URL이어야 합니다";

    private ProjectDtos() {
    }

    @Schema(name = "Project")

    public record ProjectResponse(
            UUID id,
            String name,
            String targetUrl,
            TargetUrlStatus targetUrlStatus,
            Instant targetCheckedAt,
            Integer targetCheckStatusCode,
            String targetCheckMessage,
            String queryApiBaseUrl,
            String testControlUrl,
            Instant createdAt,
            Instant updatedAt) {

        public static ProjectResponse from(Project p) {
            return new ProjectResponse(p.getId(), p.getName(), p.getTargetUrl(), p.getTargetUrlStatus(),
                    p.getTargetCheckedAt(), p.getTargetCheckStatusCode(), p.getTargetCheckMessage(),
                    p.getQueryApiBaseUrl(), p.getTestControlUrl(), p.getCreatedAt(),
                    p.getUpdatedAt());
        }
    }

    public record ProjectCreate(
            @NotBlank @Size(max = 100) String name,
            @Size(max = 500) @URL @Pattern(regexp = HTTP_URL, message = HTTP_URL_MESSAGE) String targetUrl,
            @Size(max = 500) @URL @Pattern(regexp = HTTP_URL, message = HTTP_URL_MESSAGE) String queryApiBaseUrl,
            @Size(max = 500) @URL @Pattern(regexp = HTTP_URL, message = HTTP_URL_MESSAGE) String testControlUrl) {
    }

    /** null 인 필드는 바꾸지 않는다. */
    public record ProjectUpdate(
            @Pattern(regexp = ".*\\S.*", message = "이름은 비울 수 없습니다") @Size(min = 1, max = 100) String name,
            @Size(max = 500) @URL @Pattern(regexp = HTTP_URL, message = HTTP_URL_MESSAGE) String targetUrl,
            @Size(max = 500) @URL @Pattern(regexp = HTTP_URL, message = HTTP_URL_MESSAGE) String queryApiBaseUrl,
            @Size(max = 500) @URL @Pattern(regexp = HTTP_URL, message = HTTP_URL_MESSAGE) String testControlUrl) {
    }

    @Schema(name = "TargetVerification")

    public record TargetVerificationResponse(TargetUrlStatus status, Instant checkedAt, Integer statusCode,
                                             String message) {
    }

    @Schema(name = "Activity")

    public record ActivityResponse(long id, String message, Instant createdAt) {
        public static ActivityResponse from(ActivityLog log) {
            return new ActivityResponse(log.getId(), log.getMessage(), log.getCreatedAt());
        }
    }
}
