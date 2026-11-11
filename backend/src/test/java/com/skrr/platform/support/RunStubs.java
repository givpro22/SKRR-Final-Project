package com.skrr.platform.support;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.okJson;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathMatching;

import com.github.tomakehurst.wiremock.WireMockServer;

/** M3 실행 흐름의 AI·실행기·대상 사이트 계약 응답 스텁. */
public final class RunStubs {

    public static final String TQ_PATH = "/internal/v1/test-queries/generations";
    public static final String RENDER_PATH = "/internal/v1/specs/render";
    public static final String EXEC_PATH = "/internal/v1/executions";

    private RunStubs() {
    }

    /** goto → apiRequest(captures apiQty) → captureText(uiQty), DB 사후 조회 cart_qty, 교차 검증 수량 = 3. */
    public static String testQuery(String caseCode) {
        return "{\"schemaVersion\":\"1.0\",\"testCaseCode\":\"" + caseCode + "\",\"title\":\"수량 확인\",\"variables\":{},"
                + "\"secretCaptures\":[],"
                + "\"steps\":["
                + "{\"id\":\"open_product\",\"description\":\"상품 상세 열기\",\"action\":\"goto\",\"path\":\"/products/1\"},"
                + "{\"id\":\"add_cart\",\"description\":\"장바구니 담기 API\",\"action\":\"apiRequest\",\"method\":\"POST\","
                + "\"path\":\"/api/cart/items\",\"headers\":{\"X-User\":\"{{memberEmail}}\"},"
                + "\"body\":{\"password\":\"{{memberPassword}}\"},\"expectStatus\":201,\"captures\":{\"apiQty\":\"$.qty\"}},"
                + "{\"id\":\"read_qty\",\"description\":\"화면 수량 읽기\",\"action\":\"captureText\",\"testId\":\"cart-qty\",\"as\":\"uiQty\"}],"
                + "\"dbChecks\":[{\"id\":\"cart_qty\",\"label\":\"DB 장바구니 수량\",\"phase\":\"AFTER\","
                + "\"path\":\"/api/test/query/cart?email={{memberEmail}}\",\"jsonPath\":\"$.qty\"}],"
                + "\"crossChecks\":[{\"label\":\"장바구니 수량\",\"uiCapture\":\"uiQty\",\"apiCapture\":\"apiQty\","
                + "\"dbCheckId\":\"cart_qty\",\"expected\":\"3\",\"normalize\":\"NUMBER\"}]}";
    }

    public static void aiTestQuery(WireMockServer ai, String result) {
        ai.stubFor(post(urlEqualTo(TQ_PATH)).willReturn(aResponse().withStatus(202)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"jobId\":\"tq-1\",\"type\":\"TEST_QUERY_GENERATE\",\"status\":\"QUEUED\"}")));
        ai.stubFor(get(urlEqualTo("/internal/v1/jobs/tq-1")).willReturn(okJson(
                "{\"jobId\":\"tq-1\",\"type\":\"TEST_QUERY_GENERATE\",\"status\":\"SUCCEEDED\",\"result\":" + result
                        + ",\"error\":null}")));
    }

    public static String tqResult(String caseCode, boolean passed) {
        return "{\"kind\":\"TEST_QUERY_GENERATE\",\"testQuery\":" + testQuery(caseCode) + ",\"guard\":{\"passed\":" + passed
                + ",\"attempts\":1,\"failures\":" + (passed ? "[]"
                : "[{\"kind\":\"UNKNOWN_TEST_ID\",\"message\":\"카탈로그에 'cart-qty' 없음\",\"subject\":\"cart-qty\"}]") + "}}";
    }

    public static void render(WireMockServer runner) {
        runner.stubFor(post(urlEqualTo(RENDER_PATH)).willReturn(okJson(
                "{\"specSource\":\"import { test } from '@playwright/test';\\ntest('TC', async () => {});\","
                        + "\"fileName\":\"tc-01.spec.ts\",\"rendererVersion\":\"1.0.0\",\"compileStatus\":\"PASSED\",\"compileErrors\":[]}")));
    }

    public static void startAccepted(WireMockServer runner) {
        runner.stubFor(post(urlEqualTo(EXEC_PATH)).willReturn(aResponse().withStatus(202)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"executionId\":\"00000000-0000-0000-0000-00000000e001\",\"status\":\"QUEUED\"}")));
    }

    public static String sse(String status) {
        return event("status", "{\"status\":\"RUNNING\"}")
                + event("step", "{\"stepId\":\"open_product\",\"order\":1,\"kind\":\"UI\",\"title\":\"상품 상세 열기\",\"status\":\"PASSED\"}")
                + event("screenshot", "{\"stepId\":\"open_product\",\"order\":1,\"name\":\"step-1.png\",\"pagePath\":\"/products/1\"}")
                + event("api.call", "{\"method\":\"POST\",\"path\":\"/api/cart/items\",\"statusCode\":201,\"durationMs\":42,"
                        + "\"occurredAt\":\"2026-11-10T01:00:00Z\"}")
                + event("step", "{\"stepId\":\"add_cart\",\"order\":2,\"kind\":\"API\",\"title\":\"장바구니 담기 API\",\"status\":\"PASSED\"}")
                + event("log", "{\"kind\":\"UI\",\"message\":\"password=***\"}")
                + event("step", "{\"stepId\":\"read_qty\",\"order\":3,\"kind\":\"UI\",\"title\":\"화면 수량 읽기\",\"status\":\"PASSED\","
                        + "\"actualValue\":\"3\"}")
                + event("status", "{\"status\":\"" + status + "\"}");
    }

    private static String event(String type, String data) {
        return "event: " + type + "\ndata: {\"type\":\"" + type + "\",\"occurredAt\":\"2026-11-10T01:00:00Z\",\"data\":"
                + data + "}\n\n";
    }

    public static String execution(String status, String uiQty, String apiQty, String failureType) {
        return "{\"executionId\":\"00000000-0000-0000-0000-00000000e001\",\"status\":\"" + status + "\",\"durationMs\":1500,"
                + "\"browserVersion\":\"Chromium 130.0.6723.31\","
                + "\"failureType\":" + (failureType == null ? "null" : "\"" + failureType + "\"") + ","
                + "\"failureMessage\":" + (failureType == null ? "null" : "\"실패\"") + ","
                + "\"steps\":[{\"stepId\":\"open_product\",\"order\":1,\"kind\":\"UI\",\"title\":\"상품 상세 열기\",\"status\":\"PASSED\"},"
                + "{\"stepId\":\"add_cart\",\"order\":2,\"kind\":\"API\",\"title\":\"장바구니 담기 API\",\"status\":\"PASSED\","
                + "\"schemaCheck\":\"PASSED\"},"
                + "{\"stepId\":\"read_qty\",\"order\":3,\"kind\":\"UI\",\"title\":\"화면 수량 읽기\",\"status\":\"PASSED\",\"actualValue\":\""
                + uiQty + "\"}],"
                + "\"apiCalls\":[{\"method\":\"POST\",\"path\":\"/api/cart/items\",\"statusCode\":201,\"durationMs\":42}],"
                + "\"captures\":{\"uiQty\":\"" + uiQty + "\",\"apiQty\":\"" + apiQty + "\"},\"consoleErrors\":[],"
                + "\"artifacts\":[{\"kind\":\"SCREENSHOT\",\"name\":\"step-1.png\",\"contentType\":\"image/png\",\"stepId\":\"open_product\"},"
                + "{\"kind\":\"TRACE\",\"name\":\"trace.zip\",\"contentType\":\"application/zip\"},"
                + "{\"kind\":\"HAR\",\"name\":\"network.har\",\"contentType\":\"application/json\"}]}";
    }

    public static void execution(WireMockServer runner, String status, String uiQty, String apiQty,
                                 String failureType) {
        runner.stubFor(get(urlPathMatching(EXEC_PATH + "/[^/]+/events")).willReturn(aResponse().withStatus(200)
                .withHeader("Content-Type", "text/event-stream").withBody(sse(status))));
        runner.stubFor(get(urlPathMatching(EXEC_PATH + "/[^/]+")).willReturn(okJson(
                execution(status, uiQty, apiQty, failureType))));
        runner.stubFor(get(urlPathMatching(EXEC_PATH + "/[^/]+/artifacts/.+")).willReturn(aResponse().withStatus(200)
                .withHeader("Content-Type", "application/octet-stream").withBody(new byte[] {1, 2, 3})));
        runner.stubFor(post(urlPathMatching(EXEC_PATH + "/[^/]+/cancel")).willReturn(aResponse().withStatus(202)));
    }

    public static void target(WireMockServer target, int dbQty) {
        target.stubFor(post(urlEqualTo("/api/test/reset")).willReturn(okJson("{\"ok\":true}")));
        target.stubFor(get(urlEqualTo("/api/test/version")).willReturn(okJson("{\"build\":\"a3f9c21\"}")));
        target.stubFor(get(urlPathMatching("/api/test/query/cart")).willReturn(okJson("{\"qty\":" + dbQty + "}")));
    }

    /** 정상 경로 전체: AI 통과, 렌더 통과, 실행 PASSED, DB 수량 3. */
    public static void happyPath(WireMockServer ai, WireMockServer runner, WireMockServer target) {
        aiTestQuery(ai, tqResult("TC-01", true));
        render(runner);
        startAccepted(runner);
        execution(runner, "PASSED", "3", "3", null);
        target(target, 3);
    }
}
