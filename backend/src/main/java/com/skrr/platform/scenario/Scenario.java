package com.skrr.platform.scenario;

import com.skrr.platform.common.error.InvalidStateTransitionException;
import com.skrr.platform.common.time.Times;
import com.skrr.platform.scenario.JsonValues.GuardFailure;
import com.skrr.platform.scenario.JsonValues.Reference;
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
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** 시나리오 (UI-02-5, FR-03). 상태 변경은 transitionTo 로만 한다. */
@Entity
@Table(name = "scenario")
public class Scenario {

    public static final int MAX_GUARD_ATTEMPTS = 3;

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "test_request_id", nullable = false)
    private UUID testRequestId;

    @Column(nullable = false, length = 20)
    private String code;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(name = "requirement_ref", length = 50)
    private String requirementRef;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(nullable = false, columnDefinition = "text[]")
    private String[] scopes = new String[0];

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ScenarioStatus status;

    @Column(name = "guard_attempt", nullable = false)
    private short guardAttempt;

    @Column(name = "guard_message")
    private String guardMessage;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "guard_failures", nullable = false)
    private List<GuardFailure> guardFailures = new ArrayList<>();

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "references_json", nullable = false)
    private List<Reference> references = new ArrayList<>();

    @Column(nullable = false)
    private int version = 1;

    @Column(name = "approved_by")
    private UUID approvedBy;

    @Column(name = "approved_at")
    private Instant approvedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Scenario() {
    }

    /** 생성 결과로 만든다. 가드를 통과했으면 REVIEW_REQUIRED, 아니면 GUARD_FAILED (state-machines.md). */
    public Scenario(UUID testRequestId, String code, Content content, Guard guard) {
        this.testRequestId = testRequestId;
        this.code = code;
        applyContent(content);
        applyGuard(guard);
        this.status = guard.passed() ? ScenarioStatus.REVIEW_REQUIRED : ScenarioStatus.GUARD_FAILED;
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

    /** 시나리오 내용 (제목, 요구사항 ID, 검증 범위, 근거). */
    public record Content(String title, String requirementRef, List<VerificationScope> scopes,
                          List<Reference> references) {
    }

    /** 가드 결과. */
    public record Guard(boolean passed, int attempts, List<GuardFailure> failures) {
        public String lastMessage() {
            return failures == null || failures.isEmpty() ? null : failures.get(failures.size() - 1).message();
        }
    }

    public void transitionTo(ScenarioStatus next) {
        if (!status.canTransitionTo(next)) {
            throw new InvalidStateTransitionException("시나리오", status, next);
        }
        status = next;
        if (next != ScenarioStatus.APPROVED) {
            approvedBy = null;
            approvedAt = null;
        }
    }

    public void approve(UUID userId, Instant at) {
        transitionTo(ScenarioStatus.APPROVED);
        approvedBy = userId;
        approvedAt = at;
    }

    public void reject() {
        transitionTo(ScenarioStatus.REJECTED);
    }

    /** 사용자가 고칠 수 있는 상태인지 (동작 표). 아니면 409. */
    public void requireEditable() {
        if (!ScenarioStatus.EDITABLE.contains(status)) {
            throw new InvalidStateTransitionException("시나리오", status, ScenarioStatus.REVIEW_REQUIRED);
        }
    }

    /**
     * 사용자가 내용을 바꿈. version 을 올리고 승인을 해제해 REVIEW_REQUIRED 로 돌린다 (FR-03).
     * 이미 REVIEW_REQUIRED 면 상태는 그대로 둔다.
     */
    public void contentChangedByUser() {
        requireEditable();
        version++;
        if (status != ScenarioStatus.REVIEW_REQUIRED) {
            transitionTo(ScenarioStatus.REVIEW_REQUIRED);
        }
    }

    /**
     * 사용자 수정. 바뀐 것이 있으면 true. requirementRefPresent 가 참이면 newRequirementRef 로 바꾸며
     * null·빈 문자열은 지움이다.
     */
    public boolean edit(String newTitle, boolean requirementRefPresent, String newRequirementRef,
                        List<VerificationScope> newScopes) {
        requireEditable();
        boolean changed = false;
        if (newTitle != null && !newTitle.equals(title)) {
            title = newTitle;
            changed = true;
        }
        if (requirementRefPresent) {
            String value = newRequirementRef == null || newRequirementRef.isBlank() ? null : newRequirementRef.trim();
            if (!Objects.equals(value, requirementRef)) {
                requirementRef = value;
                changed = true;
            }
        }
        if (newScopes != null && !newScopes.equals(getScopes())) {
            scopes = toArray(newScopes);
            changed = true;
        }
        if (changed) {
            contentChangedByUser();
        }
        return changed;
    }

    public void startRegeneration() {
        requireEditable();
        transitionTo(ScenarioStatus.GENERATING);
    }

    /** 재생성 작업 진행. attempt 2 이상이면 GUARD_RETRY, 1이면 GENERATING. */
    public void regenerationProgress(int attempt, String message) {
        ScenarioStatus target = attempt >= 2 ? ScenarioStatus.GUARD_RETRY : ScenarioStatus.GENERATING;
        if (status != target && status.canTransitionTo(target)) {
            transitionTo(target);
        }
        if (attempt > 0) {
            guardAttempt = (short) Math.min(MAX_GUARD_ATTEMPTS, attempt);
        }
        if (message != null && !message.isBlank()) {
            guardMessage = message;
        }
    }

    /** 재생성 결과 반영. 코드는 유지하고 version 을 올린다. */
    public void regenerated(Content content, Guard guard) {
        if (!status.isGenerating()) {
            throw new InvalidStateTransitionException("시나리오", status, ScenarioStatus.REVIEW_REQUIRED);
        }
        applyContent(content);
        applyGuard(guard);
        version++;
        finishGeneration(guard.passed());
    }

    /** 재생성 작업이 AI 장애로 실패함. 이전 내용을 그대로 두고, 이전 가드 결과로 끝 상태를 정한다. */
    public void regenerationFailed(String message) {
        if (!status.isGenerating()) {
            return;
        }
        guardMessage = message;
        finishGeneration(guardFailures.isEmpty());
    }

    private void finishGeneration(boolean passed) {
        if (passed) {
            if (status == ScenarioStatus.GUARD_RETRY) {
                transitionTo(ScenarioStatus.GENERATING);
            }
            transitionTo(ScenarioStatus.REVIEW_REQUIRED);
        } else {
            if (status == ScenarioStatus.GENERATING) {
                transitionTo(ScenarioStatus.GUARD_RETRY);
            }
            transitionTo(ScenarioStatus.GUARD_FAILED);
        }
    }

    private void applyContent(Content content) {
        this.title = content.title();
        this.requirementRef = content.requirementRef();
        this.scopes = toArray(content.scopes());
        this.references = content.references() == null ? new ArrayList<>() : new ArrayList<>(content.references());
    }

    private void applyGuard(Guard guard) {
        this.guardAttempt = (short) Math.max(0, Math.min(MAX_GUARD_ATTEMPTS, guard.attempts()));
        this.guardFailures = guard.failures() == null ? new ArrayList<>() : new ArrayList<>(guard.failures());
        this.guardMessage = guard.lastMessage();
    }

    private static String[] toArray(List<VerificationScope> list) {
        return list == null ? new String[0] : list.stream().map(Enum::name).distinct().toArray(String[]::new);
    }

    public boolean catalogGap() {
        return guardFailures.stream().anyMatch(f -> f.kind() == GuardFailureKind.CATALOG_GAP);
    }

    public int number() {
        return Integer.parseInt(code.substring(code.indexOf('-') + 1));
    }

    public UUID getId() {
        return id;
    }

    public UUID getTestRequestId() {
        return testRequestId;
    }

    public String getCode() {
        return code;
    }

    public String getTitle() {
        return title;
    }

    public String getRequirementRef() {
        return requirementRef;
    }

    public List<VerificationScope> getScopes() {
        return Arrays.stream(scopes).map(VerificationScope::valueOf).toList();
    }

    public ScenarioStatus getStatus() {
        return status;
    }

    public int getGuardAttempt() {
        return guardAttempt;
    }

    public String getGuardMessage() {
        return guardMessage;
    }

    public List<GuardFailure> getGuardFailures() {
        return guardFailures;
    }

    public List<Reference> getReferences() {
        return references;
    }

    public int getVersion() {
        return version;
    }

    public UUID getApprovedBy() {
        return approvedBy;
    }

    public Instant getApprovedAt() {
        return approvedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
