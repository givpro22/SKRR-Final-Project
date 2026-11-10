package com.skrr.platform.client.runner;

/**
 * 실행기가 요청을 4xx(계약상 400 INVALID_REQUEST)로 거부함. 대상 사이트 실패가 아니라 백엔드 요청 오류이므로
 * 결과를 저장하지 않고 500 INTERNAL_ERROR 로 응답한다 (2차 결정, 리더 판단 2).
 */
public class RunnerRequestRejectedException extends RuntimeException {
    public RunnerRequestRejectedException(String message, Throwable cause) {
        super(message, cause);
    }
}
