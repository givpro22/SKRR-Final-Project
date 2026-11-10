package com.skrr.platform.common.job;

/** AI 작업 결과가 계약과 맞지 않아 저장할 수 없음. 작업을 실패로 끝낸다. */
public class InvalidJobResultException extends RuntimeException {
    public InvalidJobResultException(String message) {
        super(message);
    }
}
