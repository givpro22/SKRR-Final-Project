package com.skrr.platform.run;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.skrr.platform.client.target.TargetSiteClient;
import org.junit.jupiter.api.Test;

/** dbChecks.path = queryApiBaseUrl 의 출처 기준 전체 경로, 조회 API 경로 밖은 거부 (state-machines.md Run). */
class TargetQueryUrlTest {

    @Test
    void fullServerPathUsesOrigin() {
        assertThat(TargetSiteClient.queryUrl("http://shop:8080/api/test/query",
                "/api/test/query/cart-items?memberEmail=a@b"))
                .isEqualTo("http://shop:8080/api/test/query/cart-items?memberEmail=a@b");
        assertThat(TargetSiteClient.queryUrl("http://shop:8080/api/test/query/", "/api/test/query"))
                .isEqualTo("http://shop:8080/api/test/query");
        assertThat(TargetSiteClient.queryUrl("http://shop:8080", "/anything")).isEqualTo("http://shop:8080/anything");
    }

    @Test
    void pathOutsideQueryApiIsRejected() {
        assertThat(TargetSiteClient.isUnderQueryApi("http://shop:8080/api/test/query", "/cart?email=x")).isFalse();
        assertThat(TargetSiteClient.isUnderQueryApi("http://shop:8080/api/test/query", "/api/test/query-admin")).isFalse();
        assertThat(TargetSiteClient.isUnderQueryApi("http://shop:8080/api/test/query", "/api/orders")).isFalse();
        assertThatThrownBy(() -> TargetSiteClient.queryUrl("http://shop:8080/api/test/query", "/api/test/reset"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
