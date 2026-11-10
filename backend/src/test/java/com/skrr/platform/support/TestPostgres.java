package com.skrr.platform.support;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.io.IOException;
import java.io.UncheckedIOException;

/** Docker 없이 실제 PostgreSQL 16 바이너리를 띄운다. JVM 당 1개를 함께 쓴다. */
public final class TestPostgres {

    private static EmbeddedPostgres instance;

    private TestPostgres() {
    }

    public static synchronized EmbeddedPostgres get() {
        if (instance == null) {
            try {
                instance = EmbeddedPostgres.builder().start();
            } catch (IOException ex) {
                throw new UncheckedIOException("내장 PostgreSQL을 시작하지 못했습니다", ex);
            }
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                try {
                    instance.close();
                } catch (IOException ignored) {
                    // 종료 중
                }
            }));
        }
        return instance;
    }

    public static String jdbcUrl() {
        return get().getJdbcUrl("postgres", "postgres");
    }
}
