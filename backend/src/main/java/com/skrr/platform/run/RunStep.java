package com.skrr.platform.run;

import com.skrr.platform.common.time.Times;
import com.skrr.platform.run.RunEnums.SchemaCheckStatus;
import com.skrr.platform.run.RunEnums.StepKind;
import com.skrr.platform.run.RunEnums.StepStatus;
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

/** 케이스 시도 1회의 단계. 케이스 시작 때 모든 단계를 PENDING 으로 만들어 "3/6 단계"를 표시할 수 있게 한다. */
@Entity
@Table(name = "run_step")
public class RunStep {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "case_result_id", nullable = false)
    private UUID caseResultId;

    @Column(nullable = false)
    private short attempt;

    @Column(nullable = false)
    private short ord;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private StepKind kind;

    @Column(nullable = false, length = 300)
    private String title;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private StepStatus status = StepStatus.PENDING;

    @Column
    private String detail;

    @Column(name = "expected_value")
    private String expectedValue;

    @Column(name = "actual_value")
    private String actualValue;

    @Enumerated(EnumType.STRING)
    @Column(name = "schema_check", length = 20)
    private SchemaCheckStatus schemaCheck;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    protected RunStep() {
    }

    public RunStep(UUID caseResultId, int attempt, int ord, StepKind kind, String title) {
        this.caseResultId = caseResultId;
        this.attempt = (short) attempt;
        this.ord = (short) ord;
        this.kind = kind;
        this.title = title == null || title.isBlank() ? kind.name() : title.length() > 300 ? title.substring(0, 300) : title;
    }

    public void update(StepStatus next, String newDetail, String expected, String actual) {
        if (next == StepStatus.RUNNING && startedAt == null) {
            startedAt = Times.now();
        }
        if (next != StepStatus.PENDING && next != StepStatus.RUNNING) {
            if (startedAt == null) {
                startedAt = Times.now();
            }
            finishedAt = Times.now();
        }
        status = next;
        if (newDetail != null) {
            detail = newDetail;
        }
        if (expected != null) {
            expectedValue = expected;
        }
        if (actual != null) {
            actualValue = actual;
        }
    }

    public void recordSchemaCheck(SchemaCheckStatus check) {
        this.schemaCheck = check;
    }

    public UUID getId() {
        return id;
    }

    public UUID getCaseResultId() {
        return caseResultId;
    }

    public int getAttempt() {
        return attempt;
    }

    public int getOrd() {
        return ord;
    }

    public StepKind getKind() {
        return kind;
    }

    public String getTitle() {
        return title;
    }

    public StepStatus getStatus() {
        return status;
    }

    public String getDetail() {
        return detail;
    }

    public String getExpectedValue() {
        return expectedValue;
    }

    public String getActualValue() {
        return actualValue;
    }

    public SchemaCheckStatus getSchemaCheck() {
        return schemaCheck;
    }
}
