package com.skrr.platform.common.error;

import java.util.LinkedHashMap;
import java.util.Map;

/** 계약의 Problem 응답으로 바뀌는 업무 예외. properties 는 응답 본문 최상위 필드로 나간다. */
public class ApiException extends RuntimeException {

    private final ErrorCode code;
    private final Map<String, Object> properties;

    public ApiException(ErrorCode code, String detail) {
        this(code, detail, Map.of());
    }

    public ApiException(ErrorCode code, String detail, Map<String, Object> properties) {
        super(detail);
        this.code = code;
        this.properties = new LinkedHashMap<>(properties);
    }

    public ErrorCode code() {
        return code;
    }

    public Map<String, Object> properties() {
        return properties;
    }

    public static ApiException notFound(String what) {
        return new ApiException(ErrorCode.RESOURCE_NOT_FOUND, what + "을(를) 찾을 수 없습니다");
    }
}
