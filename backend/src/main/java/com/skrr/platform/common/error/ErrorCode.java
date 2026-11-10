package com.skrr.platform.common.error;

import org.springframework.http.HttpStatus;

/** platform-api.openapi.yaml 의 ErrorCode 와 같은 목록이다. */
public enum ErrorCode {
    VALIDATION_FAILED(HttpStatus.BAD_REQUEST, "입력값이 올바르지 않습니다"),
    RESOURCE_NOT_FOUND(HttpStatus.NOT_FOUND, "대상을 찾을 수 없습니다"),
    FILE_TOO_LARGE(HttpStatus.PAYLOAD_TOO_LARGE, "파일이 너무 큽니다"),
    UNSUPPORTED_FILE_TYPE(HttpStatus.BAD_REQUEST, "지원하지 않는 파일 형식입니다"),
    TARGET_URL_MISSING(HttpStatus.CONFLICT, "대상 사이트 URL이 없습니다"),
    MISSING_REQUIRED_DOCUMENTS(HttpStatus.CONFLICT, "필수 문서가 빠졌습니다"),
    KNOWLEDGE_BASE_NOT_READY(HttpStatus.CONFLICT, "지식 베이스가 준비되지 않았습니다"),
    INVALID_STATE_TRANSITION(HttpStatus.CONFLICT, "현재 상태에서 할 수 없는 요청입니다"),
    SCENARIO_NOT_APPROVED(HttpStatus.CONFLICT, "승인되지 않은 시나리오가 있습니다"),
    RUN_NOT_FINISHED(HttpStatus.CONFLICT, "실행이 끝나지 않았습니다"),
    RUN_ALREADY_ACTIVE(HttpStatus.CONFLICT, "이미 진행 중인 실행이 있습니다"),
    DEPENDENCY_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "연동 서비스를 사용할 수 없습니다"),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "서버 오류가 발생했습니다");

    private final HttpStatus status;
    private final String title;

    ErrorCode(HttpStatus status, String title) {
        this.status = status;
        this.title = title;
    }

    public HttpStatus status() {
        return status;
    }

    public String title() {
        return title;
    }

    /** 프레임워크가 만든 오류 응답에 붙일 기본 코드. */
    public static ErrorCode forStatus(int status) {
        return switch (status) {
            case 400, 405, 406, 415 -> VALIDATION_FAILED;
            case 404 -> RESOURCE_NOT_FOUND;
            case 409 -> INVALID_STATE_TRANSITION;
            case 413 -> FILE_TOO_LARGE;
            case 502, 503, 504 -> DEPENDENCY_UNAVAILABLE;
            default -> INTERNAL_ERROR;
        };
    }
}
