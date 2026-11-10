package com.skrr.platform.common.job;

import com.skrr.platform.client.ai.AiJob;

/**
 * 작업 종류별 처리. AsyncJobPoller 가 원격 호출과 재시도를 맡고, 핸들러는 업무 상태 반영만 한다.
 * on* 메서드는 작업 행이 잠긴 트랜잭션 안에서 불린다.
 */
public interface AsyncJobHandler {

    JobType type();

    /** AI 서버에 작업을 보낸다. 트랜잭션 밖에서 불린다. */
    AiJob submit(AsyncJob job);

    void onProgress(AsyncJob job, AiJob remote);

    void onSucceeded(AsyncJob job, AiJob remote);

    /** 작업이 실패나 취소로 끝남. 업무 대상을 실패 상태로 돌린다. */
    void onFailed(AsyncJob job, String message);

    /** AI 서버가 실패로 끝낸 작업. remote 의 result 에 세부 오류가 있을 수 있다. */
    default void onFailed(AsyncJob job, String message, AiJob remote) {
        onFailed(job, message);
    }
}
