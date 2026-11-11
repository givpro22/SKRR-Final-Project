package com.skrr.platform.run;

import com.skrr.platform.common.error.InvalidStateTransitionException;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;

@Entity
@Table(name = "scenario_run")
public class ScenarioRun {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "run_id", nullable = false)
    private UUID runId;

    @Column(name = "scenario_id", nullable = false)
    private UUID scenarioId;

    @Column(nullable = false)
    private short ord;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ScenarioRunStatus status = ScenarioRunStatus.WAITING;

    @Column(name = "duration_ms")
    private Long durationMs;

    protected ScenarioRun() {
    }

    public ScenarioRun(UUID runId, UUID scenarioId, int ord) {
        this.runId = runId;
        this.scenarioId = scenarioId;
        this.ord = (short) ord;
    }

    public void transitionTo(ScenarioRunStatus next) {
        if (!status.allowedNext().contains(next)) {
            throw new InvalidStateTransitionException("시나리오 실행", status, next);
        }
        status = next;
    }

    public void finish(ScenarioRunStatus next, long duration) {
        transitionTo(next);
        durationMs = duration;
    }

    public UUID getId() {
        return id;
    }

    public UUID getRunId() {
        return runId;
    }

    public UUID getScenarioId() {
        return scenarioId;
    }

    public int getOrd() {
        return ord;
    }

    public ScenarioRunStatus getStatus() {
        return status;
    }

    public Long getDurationMs() {
        return durationMs;
    }
}
