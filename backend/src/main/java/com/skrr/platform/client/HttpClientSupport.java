package com.skrr.platform.client;

import com.skrr.platform.common.config.SkrrProperties;
import java.time.Duration;
import java.util.function.Supplier;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/** 내부 서비스 호출용 공통 설정. 호출마다 연결·읽기 시간 제한을 둔다. */
public final class HttpClientSupport {

    private HttpClientSupport() {
    }

    public static RestClient restClient(RestClient.Builder builder, SkrrProperties.Client config) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(config.connectTimeout());
        factory.setReadTimeout(config.readTimeout());
        return builder.clone()
                .baseUrl(config.baseUrl())
                .requestFactory(factory)
                .build();
    }

    /** retryable 예외일 때만 지수 백오프로 다시 시도한다. */
    public static <T> T withRetry(int maxAttempts, Duration initialBackoff,
                                  Class<? extends RuntimeException> retryOn, Supplier<T> call) {
        RuntimeException last = null;
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return call.get();
            } catch (RuntimeException ex) {
                if (!retryOn.isInstance(ex)) {
                    throw ex;
                }
                last = ex;
                if (attempt < maxAttempts) {
                    sleep(initialBackoff.multipliedBy(1L << (attempt - 1)));
                }
            }
        }
        throw last;
    }

    private static void sleep(Duration duration) {
        try {
            Thread.sleep(duration.toMillis());
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("재시도 대기 중 중단됨", ex);
        }
    }
}
