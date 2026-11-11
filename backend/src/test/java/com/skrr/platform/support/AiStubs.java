package com.skrr.platform.support;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.okJson;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;

import com.github.tomakehurst.wiremock.WireMockServer;

/** AI 서버 계약 응답 스텁 (ai-api.openapi.yaml). */
public final class AiStubs {

    public static final String REFINE_PATH = "/internal/v1/requests/refinements";
    public static final String GENERATE_PATH = "/internal/v1/scenarios/generations";

    private AiStubs() {
    }

    public static void accept(WireMockServer ai, String path, String jobId, String type) {
        ai.stubFor(post(urlEqualTo(path)).willReturn(aResponse().withStatus(202)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"jobId\":\"" + jobId + "\",\"type\":\"" + type + "\",\"status\":\"QUEUED\"}")));
    }

    public static void job(WireMockServer ai, String jobId, String body) {
        ai.stubFor(get(urlEqualTo("/internal/v1/jobs/" + jobId)).willReturn(okJson(body)));
    }

    public static String succeeded(String jobId, String type, String result) {
        return "{\"jobId\":\"" + jobId + "\",\"type\":\"" + type + "\",\"status\":\"SUCCEEDED\",\"result\":" + result
                + ",\"error\":null}";
    }

    public static String failed(String jobId, String type, String code, boolean retryable) {
        return "{\"jobId\":\"" + jobId + "\",\"type\":\"" + type + "\",\"status\":\"FAILED\",\"result\":null,"
                + "\"error\":{\"code\":\"" + code + "\",\"message\":\"" + code + " 발생\",\"retryable\":" + retryable + "}}";
    }

    public static String refinement(int count) {
        StringBuilder candidates = new StringBuilder();
        for (int i = 1; i <= count; i++) {
            if (i > 1) {
                candidates.append(',');
            }
            candidates.append("{\"refinedText\":\"장바구니 담기 후보 ").append(i).append("\",\"references\":[")
                    .append("{\"sourceType\":\"REQUIREMENT\",\"sourceId\":\"FR-CART-0").append(i)
                    .append("\",\"title\":\"장바구니\",\"excerpt\":\"회원은 상품을 담는다\",\"score\":0.9}]}");
        }
        return "{\"kind\":\"REQUEST_REFINE\",\"candidates\":[" + candidates + "]}";
    }

    public static String testCase(String code) {
        return "{\"code\":\"" + code + "\",\"title\":\"" + code + " 수량 확인\",\"type\":\"NORMAL\",\"scopes\":[\"UI\",\"DB\"],"
                + "\"preconditions\":[\"회원 로그인\"],\"steps\":[\"상품 상세 열기\",\"담기\"],"
                + "\"expectedResult\":\"수량이 같다\",\"expectedValues\":[{\"label\":\"수량\",\"expected\":\"3\"},"
                + "{\"label\":\"주문 번호\",\"consistencyOnly\":true,\"reason\":\"실행마다 다름\"}]}";
    }

    public static String scenario(String code, boolean passed, String... caseCodes) {
        StringBuilder cases = new StringBuilder();
        for (int i = 0; i < caseCodes.length; i++) {
            if (i > 0) {
                cases.append(',');
            }
            cases.append(testCase(caseCodes[i]));
        }
        String failures = passed ? "[]"
                : "[{\"kind\":\"UNKNOWN_TEST_ID\",\"message\":\"카탈로그에 'cart-x'가 없음\",\"subject\":\"cart-x\"},"
                + "{\"kind\":\"CATALOG_GAP\",\"message\":\"카탈로그에 'cart-remove-button' 요소가 없어 생성할 수 없음\",\"subject\":\"cart-remove-button\"}]";
        return "{\"code\":\"" + code + "\",\"title\":\"" + code + " 장바구니 담기\",\"requirementRef\":\"FR-CART-01\","
                + "\"scopes\":[\"UI\",\"API\",\"DB\"],\"references\":[{\"sourceType\":\"REQUIREMENT\",\"sourceId\":\"FR-CART-01\","
                + "\"title\":null,\"excerpt\":\"장바구니\",\"score\":0.8}],"
                + "\"guard\":{\"passed\":" + passed + ",\"attempts\":" + (passed ? 1 : 3) + ",\"failures\":" + failures + "},"
                + "\"testCases\":[" + cases + "]}";
    }

    public static String generation(String... scenarios) {
        return "{\"kind\":\"SCENARIO_GENERATE\",\"scenarios\":[" + String.join(",", scenarios) + "]}";
    }
}
