package com.skrr.platform.common.job;

import java.util.EnumSet;
import java.util.Set;

/**
 * enum:JobStatus. 백엔드 내부 추적용이며 state-machines.md 에 없는 값이라 여기서만 정한다.
 * RUNNING → QUEUED 는 AI 서버가 작업을 잃어(조회 404) 다시 요청할 때 쓴다.
 */
public enum JobStatus {
    QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED;

    public Set<JobStatus> allowedNext() {
        return switch (this) {
            case QUEUED -> EnumSet.of(RUNNING, SUCCEEDED, FAILED, CANCELLED);
            case RUNNING -> EnumSet.of(QUEUED, SUCCEEDED, FAILED, CANCELLED);
            case SUCCEEDED, FAILED, CANCELLED -> EnumSet.noneOf(JobStatus.class);
        };
    }

    public boolean isOpen() {
        return this == QUEUED || this == RUNNING;
    }
}
