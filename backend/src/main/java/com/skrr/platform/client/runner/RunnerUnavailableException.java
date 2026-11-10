package com.skrr.platform.client.runner;

/** 실행기에 연결하지 못했거나 5xx·시간 초과. 대상 사이트 실패와 구분한다. */
public class RunnerUnavailableException extends RuntimeException {
    public RunnerUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
