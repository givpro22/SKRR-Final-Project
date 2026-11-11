package com.skrr.platform.request;

import java.util.EnumSet;
import java.util.Set;

/**
 * enum:TestRequestStatus. 전이 규칙은 docs/contracts/state-machines.md 의 TestRequest 를 따른다.
 * <pre>
 * REFINING → AWAITING_SELECTION → GENERATING → GENERATED
 *        ↘ FAILED                          ↘ FAILED
 * </pre>
 * FAILED 에서 다시 시도하려면 새 요청을 만든다.
 */
public enum TestRequestStatus {
    REFINING, AWAITING_SELECTION, GENERATING, GENERATED, FAILED;

    public Set<TestRequestStatus> allowedNext() {
        return switch (this) {
            case REFINING -> EnumSet.of(AWAITING_SELECTION, FAILED);
            case AWAITING_SELECTION -> EnumSet.of(GENERATING);
            case GENERATING -> EnumSet.of(GENERATED, FAILED);
            case GENERATED, FAILED -> EnumSet.noneOf(TestRequestStatus.class);
        };
    }

    public boolean canTransitionTo(TestRequestStatus next) {
        return allowedNext().contains(next);
    }
}
