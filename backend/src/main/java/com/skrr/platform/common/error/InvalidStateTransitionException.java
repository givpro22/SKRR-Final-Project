package com.skrr.platform.common.error;

/** state-machines.md 표에 없는 전이. 409 INVALID_STATE_TRANSITION 으로 응답한다. */
public class InvalidStateTransitionException extends ApiException {

    public InvalidStateTransitionException(String subject, Enum<?> from, Enum<?> to) {
        super(ErrorCode.INVALID_STATE_TRANSITION,
                subject + " 상태를 " + from.name() + "에서 " + to.name() + "(으)로 바꿀 수 없습니다");
    }
}
