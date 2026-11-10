package com.skrr.platform.client.ai;

/** AI 서버가 요청을 4xx로 거부함. 같은 요청을 다시 보내도 결과가 같으므로 재시도하지 않는다. */
public class AiRequestRejectedException extends RuntimeException {
    private final int status;

    public AiRequestRejectedException(int status, String message) {
        super(message);
        this.status = status;
    }

    public int status() {
        return status;
    }
}
