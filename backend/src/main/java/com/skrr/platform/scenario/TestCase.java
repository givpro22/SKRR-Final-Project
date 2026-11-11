package com.skrr.platform.scenario;

import com.skrr.platform.common.time.Times;
import com.skrr.platform.scenario.JsonValues.ExpectedValue;
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

/**
 * 테스트 케이스. 코드 TC-12 는 요청 단위 번호이고 재생성해도 다시 쓰지 않는다.
 * 재생성으로 대체되면 지우지 않고 비활성으로 둔다(실행 기록이 참조함).
 */
@Entity
@Table(name = "test_case")
public class TestCase {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "scenario_id", nullable = false)
    private UUID scenarioId;

    @Column(name = "test_request_id", nullable = false)
    private UUID testRequestId;

    @Column(nullable = false, length = 20)
    private String code;

    @Column(nullable = false, length = 200)
    private String title;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private TestCaseType type;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(nullable = false, columnDefinition = "text[]")
    private String[] scopes = new String[0];

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private List<String> preconditions = new ArrayList<>();

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private List<String> steps = new ArrayList<>();

    @Column(name = "expected_result", nullable = false)
    private String expectedResult;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "expected_values", nullable = false)
    private List<ExpectedValue> expectedValues = new ArrayList<>();

    @Column(nullable = false)
    private short ord;

    @Column(nullable = false)
    private int version = 1;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected TestCase() {
    }

    public TestCase(UUID scenarioId, UUID testRequestId, String code, int ord, Content content) {
        this.scenarioId = scenarioId;
        this.testRequestId = testRequestId;
        this.code = code;
        this.ord = (short) ord;
        apply(content);
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

    /** 케이스 내용. 사용자 수정에서는 null 인 필드를 바꾸지 않는다. */
    public record Content(String title, TestCaseType type, List<VerificationScope> scopes, List<String> preconditions,
                          List<String> steps, String expectedResult, List<ExpectedValue> expectedValues) {
    }

    /** 사용자 수정. 바뀐 것이 있으면 version 을 올리고 true. */
    public boolean edit(Content patch) {
        boolean changed = false;
        if (patch.title() != null && !patch.title().equals(title)) {
            title = patch.title();
            changed = true;
        }
        if (patch.type() != null && patch.type() != type) {
            type = patch.type();
            changed = true;
        }
        if (patch.scopes() != null && !patch.scopes().equals(getScopes())) {
            scopes = toArray(patch.scopes());
            changed = true;
        }
        if (patch.preconditions() != null && !patch.preconditions().equals(preconditions)) {
            preconditions = new ArrayList<>(patch.preconditions());
            changed = true;
        }
        if (patch.steps() != null && !patch.steps().equals(steps)) {
            steps = new ArrayList<>(patch.steps());
            changed = true;
        }
        if (patch.expectedResult() != null && !patch.expectedResult().equals(expectedResult)) {
            expectedResult = patch.expectedResult();
            changed = true;
        }
        if (patch.expectedValues() != null && !Objects.equals(patch.expectedValues(), expectedValues)) {
            expectedValues = new ArrayList<>(patch.expectedValues());
            changed = true;
        }
        if (changed) {
            version++;
        }
        return changed;
    }

    public void deactivate() {
        active = false;
    }

    private void apply(Content content) {
        this.title = content.title();
        this.type = content.type();
        this.scopes = toArray(content.scopes());
        this.preconditions = content.preconditions() == null ? new ArrayList<>() : new ArrayList<>(content.preconditions());
        this.steps = content.steps() == null ? new ArrayList<>() : new ArrayList<>(content.steps());
        this.expectedResult = content.expectedResult();
        this.expectedValues = new ArrayList<>(content.expectedValues());
    }

    private static String[] toArray(List<VerificationScope> list) {
        return list == null ? new String[0] : list.stream().map(Enum::name).distinct().toArray(String[]::new);
    }

    public int number() {
        return Integer.parseInt(code.substring(code.indexOf('-') + 1));
    }

    public UUID getId() {
        return id;
    }

    public UUID getScenarioId() {
        return scenarioId;
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

    public TestCaseType getType() {
        return type;
    }

    public List<VerificationScope> getScopes() {
        return Arrays.stream(scopes).map(VerificationScope::valueOf).toList();
    }

    public List<String> getPreconditions() {
        return preconditions;
    }

    public List<String> getSteps() {
        return steps;
    }

    public String getExpectedResult() {
        return expectedResult;
    }

    public List<ExpectedValue> getExpectedValues() {
        return expectedValues;
    }

    public int getOrd() {
        return ord;
    }

    public int getVersion() {
        return version;
    }

    public boolean isActive() {
        return active;
    }
}
