package com.skrr.platform.document.storage;

import com.skrr.platform.common.config.SkrrProperties;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3ClientBuilder;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

@Configuration
public class StorageConfig {

    private static final Logger log = LoggerFactory.getLogger(StorageConfig.class);

    @Bean
    public FileStorage fileStorage(SkrrProperties properties) {
        SkrrProperties.Storage storage = properties.storage();
        if ("s3".equalsIgnoreCase(storage.type())) {
            return s3Storage(storage.s3());
        }
        if (!"local".equalsIgnoreCase(storage.type())) {
            throw new IllegalStateException("skrr.storage.type 은 s3 또는 local 이어야 합니다: " + storage.type());
        }
        byte[] key;
        if (storage.localSigningKey() == null || storage.localSigningKey().isBlank()) {
            key = new byte[32];
            new SecureRandom().nextBytes(key);
        } else {
            key = storage.localSigningKey().getBytes(StandardCharsets.UTF_8);
        }
        log.info("로컬 파일 저장소 사용: {}", storage.localDir().toAbsolutePath());
        return new LocalFileStorage(storage.localDir(), key);
    }

    private static FileStorage s3Storage(SkrrProperties.S3 s3) {
        if (s3.bucket() == null || s3.bucket().isBlank()) {
            throw new IllegalStateException("STORAGE_TYPE=s3 이면 S3_BUCKET 이 필요합니다");
        }
        Region region = Region.of(s3.region());
        S3Configuration serviceConfig = S3Configuration.builder().pathStyleAccessEnabled(s3.pathStyle()).build();
        S3ClientBuilder client = S3Client.builder().region(region).serviceConfiguration(serviceConfig);
        S3Presigner.Builder presigner = S3Presigner.builder().region(region).serviceConfiguration(serviceConfig);
        if (s3.endpoint() != null && !s3.endpoint().isBlank()) {
            URI endpoint = URI.create(s3.endpoint());
            client.endpointOverride(endpoint);
            presigner.endpointOverride(endpoint);
        }
        log.info("S3 저장소 사용: bucket={}, region={}", s3.bucket(), s3.region());
        return new S3FileStorage(client.build(), presigner.build(), s3.bucket());
    }
}
