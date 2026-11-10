package com.skrr.platform.common.error;

import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * 모든 오류를 application/problem+json 과 계약의 code 필드로 응답한다.
 * 프레임워크 예외는 상태 코드로 code 를 정하고, 업무 예외는 ApiException 의 code 를 쓴다.
 */
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ProblemDetail> handleApi(ApiException ex) {
        ProblemDetail body = problem(ex.code(), ex.getMessage());
        ex.properties().forEach(body::setProperty);
        return ResponseEntity.status(ex.code().status()).body(body);
    }

    @ExceptionHandler({DataIntegrityViolationException.class, PessimisticLockingFailureException.class})
    public ResponseEntity<ProblemDetail> handleConflict(RuntimeException ex) {
        log.warn("동시 변경 충돌: {}", ex.getMessage());
        ProblemDetail body = problem(ErrorCode.INVALID_STATE_TRANSITION,
                "다른 요청과 동시에 변경되어 처리하지 못했습니다. 다시 시도해 주세요.");
        return ResponseEntity.status(ErrorCode.INVALID_STATE_TRANSITION.status()).body(body);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> handleUnexpected(Exception ex) {
        log.error("처리하지 못한 오류", ex);
        ProblemDetail body = problem(ErrorCode.INTERNAL_ERROR, "서버 오류가 발생했습니다.");
        return ResponseEntity.status(ErrorCode.INTERNAL_ERROR.status()).body(body);
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        List<Map<String, String>> fieldErrors = ex.getBindingResult().getFieldErrors().stream()
                .map(GlobalExceptionHandler::toFieldError)
                .toList();
        ProblemDetail body = problem(ErrorCode.VALIDATION_FAILED, "입력값을 확인해 주세요.");
        body.setProperty("fieldErrors", fieldErrors);
        return ResponseEntity.badRequest().body(body);
    }

    @Override
    protected ResponseEntity<Object> handleHandlerMethodValidationException(
            HandlerMethodValidationException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        List<Map<String, String>> fieldErrors = ex.getAllValidationResults().stream()
                .flatMap(result -> result.getResolvableErrors().stream().map(error -> Map.of(
                        "field", String.valueOf(result.getMethodParameter().getParameterName()),
                        "message", String.valueOf(error.getDefaultMessage()))))
                .toList();
        ProblemDetail body = problem(ErrorCode.VALIDATION_FAILED, "입력값을 확인해 주세요.");
        body.setProperty("fieldErrors", fieldErrors);
        return ResponseEntity.badRequest().body(body);
    }

    @Override
    protected ResponseEntity<Object> handleMaxUploadSizeExceededException(
            MaxUploadSizeExceededException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        ProblemDetail body = problem(ErrorCode.FILE_TOO_LARGE, "파일은 20MB 이하만 올릴 수 있습니다.");
        return ResponseEntity.status(ErrorCode.FILE_TOO_LARGE.status()).body(body);
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(
            Exception ex, Object body, HttpHeaders headers, HttpStatusCode statusCode, WebRequest request) {
        if (body == null && ex instanceof ErrorResponse errorResponse) {
            body = errorResponse.getBody();
        }
        if (body instanceof ProblemDetail problem
                && (problem.getProperties() == null || !problem.getProperties().containsKey("code"))) {
            ErrorCode code = ErrorCode.forStatus(statusCode.value());
            problem.setProperty("code", code.name());
            if (problem.getTitle() == null || problem.getTitle().isBlank()) {
                problem.setTitle(code.title());
            }
        }
        return super.handleExceptionInternal(ex, body, headers, statusCode, request);
    }

    private static ProblemDetail problem(ErrorCode code, String detail) {
        ProblemDetail body = ProblemDetail.forStatusAndDetail(code.status(), detail);
        body.setTitle(code.title());
        body.setProperty("code", code.name());
        return body;
    }

    private static Map<String, String> toFieldError(FieldError error) {
        return Map.of("field", error.getField(),
                "message", error.getDefaultMessage() == null ? "올바르지 않은 값입니다" : error.getDefaultMessage());
    }
}
