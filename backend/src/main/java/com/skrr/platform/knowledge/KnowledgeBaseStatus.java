package com.skrr.platform.knowledge;

import java.util.EnumSet;
import java.util.Set;

/**
 * enum:KnowledgeBaseStatus. 전이 규칙은 docs/contracts/state-machines.md 의 KnowledgeBase 를 따른다.
 * <pre>
 * NOT_BUILT → BUILDING → READY → STALE → BUILDING
 *                      ↘ FAILED → BUILDING
 * </pre>
 */
public enum KnowledgeBaseStatus {
    NOT_BUILT, BUILDING, READY, STALE, FAILED;

    public Set<KnowledgeBaseStatus> allowedNext() {
        return switch (this) {
            case NOT_BUILT, STALE, FAILED -> EnumSet.of(BUILDING);
            case BUILDING -> EnumSet.of(READY, FAILED);
            case READY -> EnumSet.of(STALE);
        };
    }

    public boolean canTransitionTo(KnowledgeBaseStatus next) {
        return allowedNext().contains(next);
    }
}
