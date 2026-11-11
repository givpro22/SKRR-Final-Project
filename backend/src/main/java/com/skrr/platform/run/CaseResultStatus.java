package com.skrr.platform.run;

import java.util.EnumSet;
import java.util.Set;

/** enum:CaseResultStatus. PENDING → RUNNING → PASSED | FAILED | ERROR | CANCELLED, PENDING → SKIPPED | CANCELLED */
public enum CaseResultStatus {
    PENDING, RUNNING, PASSED, FAILED, SKIPPED, CANCELLED, ERROR;

    public Set<CaseResultStatus> allowedNext() {
        return switch (this) {
            case PENDING -> EnumSet.of(RUNNING, SKIPPED, CANCELLED);
            case RUNNING -> EnumSet.of(PASSED, FAILED, ERROR, CANCELLED);
            default -> EnumSet.noneOf(CaseResultStatus.class);
        };
    }

    public boolean isTerminal() {
        return this != PENDING && this != RUNNING;
    }
}
