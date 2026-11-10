package com.skrr.platform.document;

import static org.assertj.core.api.Assertions.assertThat;

import com.jayway.jsonpath.JsonPath;
import com.skrr.platform.support.Fixtures;
import com.skrr.platform.support.IntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.TestPropertySource;

/**
 * 믿는 프록시 목록에 루프백이 없으면(= 아무 요청자) X-Forwarded-* 를 무시하고 실제 요청 주소로 링크를 만든다.
 * 외부 요청자가 다운로드 링크의 호스트를 바꿔 피싱 링크를 만들지 못하게 하기 위해서다 (QA 지적).
 */
@TestPropertySource(properties = "server.tomcat.remoteip.internal-proxies=10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}")
class UntrustedForwardedHeadersIntegrationTest extends IntegrationTest {

    @Test
    void forwardedHeadersFromUntrustedClientAreIgnored() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        String id = Fixtures.uploadOk(mvc, projectId, "CATALOG", "catalog.csv");
        HttpHeaders headers = new HttpHeaders();
        headers.add("X-Forwarded-Proto", "https");
        headers.add("X-Forwarded-Host", "evil.example.test");
        headers.add("X-Forwarded-Port", "443");
        ResponseEntity<String> response = rest.exchange("/api/v1/documents/{id}/download-link", HttpMethod.GET,
                new HttpEntity<>(headers), String.class, id);
        String url = JsonPath.read(response.getBody(), "$.url");
        assertThat(url).startsWith(rest.getRootUri() + "/api/local-storage/").doesNotContain("evil.example.test");
    }
}
