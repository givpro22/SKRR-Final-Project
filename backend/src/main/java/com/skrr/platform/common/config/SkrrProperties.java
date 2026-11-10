package com.skrr.platform.common.config;

import java.nio.file.Path;
import java.time.Duration;
import java.util.UUID;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("skrr")
public record SkrrProperties(
        UUID defaultUserId,
        Client ai,
        Client runner,
        Jobs jobs,
        Storage storage) {

    public record Client(String baseUrl, Duration connectTimeout, Duration readTimeout) {
    }

    public record Jobs(boolean pollingEnabled, long pollIntervalMs, int maxConsecutivePollErrors) {
    }

    public record Storage(String type, Path localDir, String localSigningKey, Duration presignTtl, S3 s3) {
    }

    public record S3(String bucket, String region, String endpoint, boolean pathStyle) {
    }
}
