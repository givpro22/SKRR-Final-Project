package com.skrr.platform.document;

import java.util.EnumSet;
import java.util.Set;

/**
 * enum:DocumentStatus. 전이 규칙은 docs/contracts/state-machines.md 의 Document 를 따른다.
 * <pre>
 * UPLOADED → INDEXING → INDEXED
 *               ↑     ↘ FAILED
 *               │     ↘ SKIPPED
 *               └── INDEXED | FAILED | SKIPPED   (재구축, ADR-020)
 * UPLOADED → REGISTERED                          (TEST_DATA는 인덱싱하지 않음)
 * </pre>
 */
public enum DocumentStatus {
    UPLOADED, INDEXING, INDEXED, REGISTERED, FAILED, SKIPPED;

    public Set<DocumentStatus> allowedNext() {
        return switch (this) {
            case UPLOADED -> EnumSet.of(INDEXING, REGISTERED);
            case INDEXING -> EnumSet.of(INDEXED, FAILED, SKIPPED);
            case INDEXED, FAILED, SKIPPED -> EnumSet.of(INDEXING);
            case REGISTERED -> EnumSet.noneOf(DocumentStatus.class);
        };
    }

    public boolean canTransitionTo(DocumentStatus next) {
        return allowedNext().contains(next);
    }
}
