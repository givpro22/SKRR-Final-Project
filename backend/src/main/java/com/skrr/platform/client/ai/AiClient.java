package com.skrr.platform.client.ai;

import com.skrr.platform.client.HttpClientSupport;
import com.skrr.platform.common.config.SkrrProperties;
import java.time.Duration;
import java.util.UUID;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/** AI 서버 내부 API(ai-api.openapi.yaml) 호출. */
@Component
public class AiClient {

    static final int START_MAX_ATTEMPTS = 3;
    static final Duration START_BACKOFF = Duration.ofMillis(300);

    private final RestClient http;

    public AiClient(RestClient.Builder builder, SkrrProperties properties) {
        this.http = HttpClientSupport.restClient(builder, properties.ai());
    }

    /** operationId: startKnowledgeBaseBuild. 연결 실패와 5xx는 짧게 재시도한다. */
    public AiJob startKnowledgeBaseBuild(UUID projectId, KnowledgeBaseBuildRequest request) {
        return HttpClientSupport.withRetry(START_MAX_ATTEMPTS, START_BACKOFF, AiUnavailableException.class,
                () -> call("startKnowledgeBaseBuild", () -> http.post()
                        .uri("/internal/v1/knowledge-bases/{projectId}/builds", projectId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(request)
                        .retrieve()
                        .body(AiJob.class)));
    }

    /** operationId: getAiJob. 404는 AiJobNotFoundException. */
    public AiJob getJob(String jobId) {
        try {
            return call("getAiJob", () -> http.get()
                    .uri("/internal/v1/jobs/{jobId}", jobId)
                    .retrieve()
                    .body(AiJob.class));
        } catch (AiRequestRejectedException ex) {
            if (ex.status() == 404) {
                throw new AiJobNotFoundException(jobId);
            }
            throw ex;
        }
    }

    private static AiJob call(String operation, java.util.function.Supplier<AiJob> request) {
        try {
            AiJob job = request.get();
            if (job == null || job.jobId() == null || job.status() == null) {
                throw new AiUnavailableException(operation + " 응답에 jobId나 status가 없습니다", null);
            }
            return job;
        } catch (HttpStatusCodeException ex) {
            HttpStatusCode status = ex.getStatusCode();
            if (status.is5xxServerError()) {
                throw new AiUnavailableException(operation + " 실패: AI 서버 " + status.value(), ex);
            }
            throw new AiRequestRejectedException(status.value(),
                    operation + " 거부: " + status.value() + " " + ex.getResponseBodyAsString());
        } catch (ResourceAccessException ex) {
            throw new AiUnavailableException(operation + " 실패: AI 서버에 연결할 수 없습니다", ex);
        } catch (RestClientException ex) {
            throw new AiUnavailableException(operation + " 실패: 응답을 해석할 수 없습니다", ex);
        }
    }
}
