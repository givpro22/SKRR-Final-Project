package com.skrr.platform.scenario;

import java.util.EnumSet;
import java.util.Set;

/**
 * enum:ScenarioStatus. 전이 규칙은 docs/contracts/state-machines.md 의 Scenario 그림과 동작 표를 따른다.
 * <pre>
 * GENERATING → REVIEW_REQUIRED → APPROVED
 *     │              │              └→ REVIEW_REQUIRED (내용 수정) / GENERATING (재생성)
 *     │              ├→ GENERATING (재생성)
 *     │              └→ REJECTED → GENERATING (재생성) / REVIEW_REQUIRED (내용 수정)
 *     └→ GUARD_RETRY ⇄ GENERATING   (가드 실패, 최대 3회)
 *              └→ GUARD_FAILED → GENERATING (재생성) / REVIEW_REQUIRED (내용 수정)
 * </pre>
 * 첫 생성 결과로 만드는 행은 REVIEW_REQUIRED 또는 GUARD_FAILED 로 바로 생긴다(전이가 아님).
 */
public enum ScenarioStatus {
    GENERATING, GUARD_RETRY, REVIEW_REQUIRED, APPROVED, REJECTED, GUARD_FAILED;

    /** 사용자가 내용을 고치거나 재생성을 요청할 수 있는 상태 (동작 표). */
    public static final Set<ScenarioStatus> EDITABLE = EnumSet.of(REVIEW_REQUIRED, APPROVED, REJECTED, GUARD_FAILED);

    public Set<ScenarioStatus> allowedNext() {
        return switch (this) {
            case GENERATING -> EnumSet.of(GUARD_RETRY, REVIEW_REQUIRED);
            case GUARD_RETRY -> EnumSet.of(GENERATING, GUARD_FAILED);
            case REVIEW_REQUIRED -> EnumSet.of(APPROVED, REJECTED, GENERATING);
            case APPROVED -> EnumSet.of(REVIEW_REQUIRED, GENERATING);
            case REJECTED, GUARD_FAILED -> EnumSet.of(GENERATING, REVIEW_REQUIRED);
        };
    }

    public boolean canTransitionTo(ScenarioStatus next) {
        return allowedNext().contains(next);
    }

    public boolean isGenerating() {
        return this == GENERATING || this == GUARD_RETRY;
    }
}
