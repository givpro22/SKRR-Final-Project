package com.skrr.platform.client.runner;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skrr.platform.client.HttpClientSupport;
import com.skrr.platform.client.runner.RunnerDtos.ArtifactFile;
import com.skrr.platform.client.runner.RunnerDtos.Execution;
import com.skrr.platform.client.runner.RunnerDtos.ExecutionEvent;
import com.skrr.platform.client.runner.RunnerDtos.ExecutionRequest;
import com.skrr.platform.client.runner.RunnerDtos.RenderResult;
import com.skrr.platform.common.config.SkrrProperties;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Supplier;
import java.util.stream.Stream;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/** Playwright 실행기 내부 API(runner-api.openapi.yaml) 호출. */
@Component
public class RunnerClient {

    private final RestClient http;
    private final HttpClient streamClient;
    private final String baseUrl;
    private final Duration connectTimeout;
    private final ObjectMapper objectMapper;

    public RunnerClient(RestClient.Builder builder, SkrrProperties properties, ObjectMapper objectMapper) {
        this.http = HttpClientSupport.restClient(builder, properties.runner());
        this.baseUrl = properties.runner().baseUrl().replaceAll("/+$", "");
        this.connectTimeout = properties.runner().connectTimeout();
        this.streamClient = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(connectTimeout).build();
        this.objectMapper = objectMapper;
    }

    /**
     * operationId: checkTargetConnectivity. 대상 도달 여부 판정은 실행기가 한다 (ADR-019).
     * 실행기 자체 장애(연결 실패, 5xx, 시간 초과)는 RunnerUnavailableException,
     * 실행기가 요청을 4xx로 거부하면 RunnerRequestRejectedException 이다.
     */
    public ConnectivityResult checkTargetConnectivity(String targetUrl) {
        return HttpClientSupport.withRetry(2, Duration.ofMillis(300), RunnerUnavailableException.class,
                () -> call("checkTargetConnectivity", () -> http.post()
                        .uri("/internal/v1/connectivity-checks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(Map.of("targetUrl", targetUrl))
                        .retrieve()
                        .body(ConnectivityResult.class)));
    }

    /** operationId: renderSpec. 문법 오류도 200(compileStatus FAILED), 스키마 위반은 422. */
    public RenderResult renderSpec(Map<String, Object> testQuery) {
        return HttpClientSupport.withRetry(2, Duration.ofMillis(300), RunnerUnavailableException.class,
                () -> call("renderSpec", () -> http.post()
                        .uri("/internal/v1/specs/render")
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(Map.of("testQuery", testQuery))
                        .retrieve()
                        .body(RenderResult.class)));
    }

    /** operationId: startExecution. 409 RUNNER_BUSY 는 RunnerRequestRejectedException(code RUNNER_BUSY). */
    public Execution startExecution(ExecutionRequest request) {
        return HttpClientSupport.withRetry(2, Duration.ofMillis(300), RunnerUnavailableException.class,
                () -> call("startExecution", () -> http.post()
                        .uri("/internal/v1/executions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(request)
                        .retrieve()
                        .body(Execution.class)));
    }

    /** operationId: getExecution. */
    public Execution getExecution(UUID executionId) {
        return HttpClientSupport.withRetry(3, Duration.ofMillis(500), RunnerUnavailableException.class,
                () -> call("getExecution", () -> http.get()
                        .uri("/internal/v1/executions/{id}", executionId)
                        .retrieve()
                        .body(Execution.class)));
    }

    /** operationId: cancelExecution. 실패해도 예외를 던지지 않는다(실행이 이미 끝났을 수 있음). */
    public void cancelExecution(UUID executionId) {
        try {
            http.post().uri("/internal/v1/executions/{id}/cancel", executionId).retrieve().toBodilessEntity();
        } catch (RestClientException ignored) {
            // 이미 끝난 실행 등
        }
    }

    /** operationId: getExecutionArtifact. 409 ARTIFACT_NOT_READY·404 는 RunnerRequestRejectedException. */
    public ArtifactFile getArtifact(UUID executionId, String name) {
        return call("getExecutionArtifact", () -> {
            ResponseEntity<byte[]> response = http.get()
                    .uri("/internal/v1/executions/{id}/artifacts/{name}", executionId, name)
                    .retrieve()
                    .toEntity(byte[].class);
            MediaType type = response.getHeaders().getContentType();
            return new ArtifactFile(response.getBody() == null ? new byte[0] : response.getBody(),
                    type == null ? "application/octet-stream" : type.toString());
        });
    }

    /**
     * operationId: streamExecutionEvents. 끝 상태 status 를 받거나 실행기가 연결을 닫을 때까지 이벤트를 넘긴다.
     * 호출한 스레드에서 막힌다. 연결 자체가 실패하면 RunnerUnavailableException.
     */
    public void streamEvents(UUID executionId, Consumer<ExecutionEvent> onEvent) {
        HttpRequest request = HttpRequest.newBuilder(
                        URI.create(baseUrl + "/internal/v1/executions/" + executionId + "/events"))
                .header("Accept", "text/event-stream")
                .GET().build();
        HttpResponse<Stream<String>> response;
        try {
            response = streamClient.send(request, HttpResponse.BodyHandlers.ofLines());
        } catch (IOException ex) {
            throw new RunnerUnavailableException("실행기 이벤트 스트림에 연결할 수 없습니다", ex);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new RunnerUnavailableException("이벤트 스트림 대기 중 중단됨", ex);
        }
        if (response.statusCode() != 200) {
            response.body().close();
            throw new RunnerUnavailableException("실행기 이벤트 스트림 응답 " + response.statusCode(), null);
        }
        SseParser parser = new SseParser((event, data) -> {
            ExecutionEvent parsed = parseEvent(event, data);
            if (parsed != null) {
                onEvent.accept(parsed);
            }
        });
        try (Stream<String> lines = response.body()) {
            lines.forEach(parser::line);
            parser.flush();
        }
    }

    private ExecutionEvent parseEvent(String eventName, String data) {
        if (data == null || data.isBlank()) {
            return null;
        }
        try {
            JsonNode node = objectMapper.readTree(data);
            String type = node.hasNonNull("type") ? node.get("type").asText() : eventName;
            String occurredAt = node.hasNonNull("occurredAt") ? node.get("occurredAt").asText() : null;
            JsonNode payload = node.has("data") && node.get("data").isObject() ? node.get("data") : node;
            return new ExecutionEvent(type == null ? "message" : type, occurredAt, payload);
        } catch (IOException ex) {
            return null;
        }
    }

    private <T> T call(String operation, Supplier<T> request) {
        try {
            T result = request.get();
            if (result == null) {
                throw new RunnerUnavailableException(operation + " 응답이 비어 있습니다", null);
            }
            return result;
        } catch (HttpStatusCodeException ex) {
            if (ex.getStatusCode().is5xxServerError()) {
                throw new RunnerUnavailableException(operation + " 실패: 실행기 " + ex.getStatusCode().value(), ex);
            }
            throw new RunnerRequestRejectedException(ex.getStatusCode().value(), problemCode(ex),
                    operation + " 거부: " + ex.getStatusCode().value() + " " + ex.getResponseBodyAsString(), ex);
        } catch (ResourceAccessException ex) {
            throw new RunnerUnavailableException(operation + " 실패: 실행기에 연결할 수 없습니다", ex);
        } catch (RestClientException ex) {
            throw new RunnerUnavailableException(operation + " 실패: 응답을 해석할 수 없습니다", ex);
        }
    }

    private String problemCode(HttpStatusCodeException ex) {
        try {
            JsonNode body = objectMapper.readTree(ex.getResponseBodyAsByteArray());
            return body != null && body.hasNonNull("code") ? body.get("code").asText() : null;
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    /** text/event-stream 줄 해석기. 빈 줄에서 event 하나를 넘긴다. */
    static final class SseParser {
        private final java.util.function.BiConsumer<String, String> onEvent;
        private String event;
        private final StringBuilder data = new StringBuilder();

        SseParser(java.util.function.BiConsumer<String, String> onEvent) {
            this.onEvent = onEvent;
        }

        void line(String line) {
            if (line.isEmpty()) {
                flush();
                return;
            }
            if (line.startsWith(":")) {
                return;
            }
            int colon = line.indexOf(':');
            String field = colon < 0 ? line : line.substring(0, colon);
            String value = colon < 0 ? "" : line.substring(colon + 1);
            if (value.startsWith(" ")) {
                value = value.substring(1);
            }
            if ("event".equals(field)) {
                event = value;
            } else if ("data".equals(field)) {
                if (!data.isEmpty()) {
                    data.append('\n');
                }
                data.append(value);
            }
        }

        void flush() {
            if (!data.isEmpty() || event != null) {
                onEvent.accept(event, data.toString());
            }
            event = null;
            data.setLength(0);
        }
    }
}
