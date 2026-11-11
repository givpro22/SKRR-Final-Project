package com.skrr.platform.support;

import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 실제 PostgreSQL(내장 바이너리) + Flyway + WireMock(AI 서버, 실행기)로 앱 전체를 띄운다.
 * 스케줄러는 끄고 테스트가 AsyncJobPoller.pollOnce() 를 직접 부른다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
public abstract class IntegrationTest {

    protected static final WireMockServer AI = new WireMockServer(WireMockConfiguration.options().dynamicPort());
    protected static final WireMockServer RUNNER = new WireMockServer(WireMockConfiguration.options().dynamicPort());
    /** 테스트 대상 사이트(초기화·DB 조회·빌드 API) 대역. */
    protected static final WireMockServer TARGET = new WireMockServer(WireMockConfiguration.options().dynamicPort());
    protected static final Path STORAGE_DIR;

    static {
        AI.start();
        RUNNER.start();
        TARGET.start();
        try {
            STORAGE_DIR = Files.createTempDirectory("skrr-storage-");
        } catch (IOException ex) {
            throw new UncheckedIOException(ex);
        }
    }

    @Autowired
    protected MockMvc mvc;

    @Autowired
    protected TestRestTemplate rest;

    @Autowired
    protected JdbcTemplate jdbc;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", TestPostgres::jdbcUrl);
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "");
        registry.add("skrr.ai.base-url", AI::baseUrl);
        registry.add("skrr.runner.base-url", RUNNER::baseUrl);
        registry.add("skrr.ai.read-timeout", () -> "2s");
        registry.add("skrr.runner.read-timeout", () -> "2s");
        registry.add("skrr.jobs.polling-enabled", () -> "false");
        registry.add("skrr.jobs.max-consecutive-poll-errors", () -> "3");
        registry.add("skrr.target.control-token", () -> "test-token");
        registry.add("skrr.run.ai-poll-interval", () -> "20ms");
        registry.add("skrr.run.runner-busy-wait", () -> "50ms");
        registry.add("skrr.run.runner-busy-timeout", () -> "2s");
        registry.add("skrr.run.case-timeout", () -> "5s");
        registry.add("skrr.run.case-timeout-grace", () -> "1s");
        registry.add("skrr.run.heartbeat-ms", () -> "300");
        registry.add("skrr.storage.type", () -> "local");
        registry.add("skrr.storage.local-dir", STORAGE_DIR::toString);
    }

    @BeforeEach
    void resetState() {
        AI.resetAll();
        RUNNER.resetAll();
        TARGET.resetAll();
        jdbc.execute("TRUNCATE project, async_job, generated_spec CASCADE");
    }
}
