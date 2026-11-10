package com.skrr.platform.client.runner;

import com.skrr.platform.client.HttpClientSupport;
import com.skrr.platform.common.config.SkrrProperties;
import java.time.Duration;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/** Playwright 실행기 내부 API(runner-api.openapi.yaml) 호출. */
@Component
public class RunnerClient {

    private final RestClient http;

    public RunnerClient(RestClient.Builder builder, SkrrProperties properties) {
        this.http = HttpClientSupport.restClient(builder, properties.runner());
    }

    /**
     * operationId: checkTargetConnectivity. 대상 도달 여부 판정은 실행기가 한다 (ADR-019).
     * 실행기 자체 장애(연결 실패, 5xx, 시간 초과)는 RunnerUnavailableException,
     * 실행기가 요청을 4xx로 거부하면 RunnerRequestRejectedException 이다.
     */
    public ConnectivityResult checkTargetConnectivity(String targetUrl) {
        return HttpClientSupport.withRetry(2, Duration.ofMillis(300), RunnerUnavailableException.class, () -> {
            try {
                ConnectivityResult result = http.post()
                        .uri("/internal/v1/connectivity-checks")
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(Map.of("targetUrl", targetUrl))
                        .retrieve()
                        .body(ConnectivityResult.class);
                if (result == null) {
                    throw new RunnerUnavailableException("실행기 응답이 비어 있습니다", null);
                }
                return result;
            } catch (HttpStatusCodeException ex) {
                if (ex.getStatusCode().is5xxServerError()) {
                    throw new RunnerUnavailableException("실행기 오류 " + ex.getStatusCode().value(), ex);
                }
                throw new RunnerRequestRejectedException("실행기가 연결 확인 요청을 거부했습니다: "
                        + ex.getStatusCode().value() + " " + ex.getResponseBodyAsString(), ex);
            } catch (ResourceAccessException ex) {
                throw new RunnerUnavailableException("실행기에 연결할 수 없습니다", ex);
            } catch (RestClientException ex) {
                throw new RunnerUnavailableException("실행기 응답을 해석할 수 없습니다", ex);
            }
        });
    }
}
