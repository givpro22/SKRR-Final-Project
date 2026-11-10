package com.skrr.platform.client.ai;

/** AI 서버에 연결하지 못했거나 5xx·시간 초과. 재시도 대상이다. */
public class AiUnavailableException extends RuntimeException {
    public AiUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
