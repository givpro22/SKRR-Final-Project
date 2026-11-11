package com.skrr.platform.run;

import java.util.EnumSet;
import java.util.Set;

/** enum:ScenarioRunStatus. WAITING → RUNNING → PASSED | FAILED | ERROR | CANCELLED, WAITING → SKIPPED | CANCELLED */
public enum ScenarioRunStatus {
    WAITING, RUNNING, PASSED, FAILED, ERROR, SKIPPED, CANCELLED;

    public Set<ScenarioRunStatus> allowedNext() {
        return switch (this) {
            case WAITING -> EnumSet.of(RUNNING, SKIPPED, CANCELLED);
            case RUNNING -> EnumSet.of(PASSED, FAILED, ERROR, CANCELLED);
            default -> EnumSet.noneOf(ScenarioRunStatus.class);
        };
    }

    public boolean isTerminal() {
        return this != WAITING && this != RUNNING;
    }
}
