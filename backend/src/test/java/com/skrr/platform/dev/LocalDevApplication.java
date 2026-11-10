package com.skrr.platform.dev;

import com.skrr.platform.PlatformApplication;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.boot.SpringApplication;

/**
 * Docker 없이 로컬에서 백엔드를 띄운다. 내장 PostgreSQL 16 을 backend/data/dev-postgres 에 두고
 * local 프로필(예시 프로젝트 시드, 로컬 파일 저장소)로 앱을 시작한다.
 *
 * <pre>
 * cd backend && ./mvnw spring-boot:test-run
 * </pre>
 */
public final class LocalDevApplication {

    private LocalDevApplication() {
    }

    public static void main(String[] args) throws IOException {
        Path dataDir = Path.of("data", "dev-postgres").toAbsolutePath();
        Files.createDirectories(dataDir);
        EmbeddedPostgres postgres = EmbeddedPostgres.builder()
                .setDataDirectory(dataDir)
                .setCleanDataDirectory(false)
                .setPort(Integer.parseInt(System.getenv().getOrDefault("DEV_POSTGRES_PORT", "54329")))
                .start();
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            try {
                postgres.close();
            } catch (IOException ignored) {
                // 종료 중
            }
        }));
        System.setProperty("spring.datasource.url", postgres.getJdbcUrl("postgres", "postgres"));
        System.setProperty("spring.datasource.username", "postgres");
        System.setProperty("spring.datasource.password", "");
        SpringApplication app = new SpringApplication(PlatformApplication.class);
        app.setAdditionalProfiles("local");
        app.run(args);
    }
}
