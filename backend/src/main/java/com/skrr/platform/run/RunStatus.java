package com.skrr.platform.run;

import java.util.EnumSet;
import java.util.Set;

/**
 * enum:RunStatus. state-machines.md Run.
 * <pre>
 * PREPARING → RUNNING → PASSED | FAILED | ERROR | CANCELLING → CANCELLED
 * PREPARING → CANCELLING | ERROR
 * </pre>
 */
public enum RunStatus {
    PREPARING, RUNNING, CANCELLING, PASSED, FAILED, CANCELLED, ERROR;

    public static final Set<RunStatus> ACTIVE = EnumSet.of(PREPARING, RUNNING, CANCELLING);

    public Set<RunStatus> allowedNext() {
        return switch (this) {
            case PREPARING -> EnumSet.of(RUNNING, CANCELLING, ERROR);
            case RUNNING -> EnumSet.of(PASSED, FAILED, ERROR, CANCELLING);
            case CANCELLING -> EnumSet.of(CANCELLED);
            case PASSED, FAILED, CANCELLED, ERROR -> EnumSet.noneOf(RunStatus.class);
        };
    }

    public boolean isTerminal() {
        return !ACTIVE.contains(this);
    }
}
