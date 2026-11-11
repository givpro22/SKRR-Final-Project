package com.skrr.platform.report;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.okJson;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.skrr.platform.common.job.AsyncJobPoller;
import com.skrr.platform.support.Fixtures;
import com.skrr.platform.support.IntegrationTest;
import com.skrr.platform.support.M2Flow;
import com.skrr.platform.support.RunStubs;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/** FR-06·07: 리포트 집계, 케이스 상세, 실패 원인 분석(비동기), 이전 실행 비교·처음 발생, 재실행. */
class ReportIntegrationTest extends IntegrationTest {

    static final String ANALYSIS_PATH = "/internal/v1/failure-analyses";

    @Autowired
    AsyncJobPoller poller;

    String requestId;
    String projectId;
    String sc1;

    @BeforeEach
    void setUp() throws Exception {
        requestId = new M2Flow(mvc, jdbc, AI, poller).generatedRequest();
        projectId = jdbc.queryForObject("select project_id::text from test_request where id = ?::uuid", String.class,
                UUID.fromString(requestId));
        sc1 = jdbc.queryForObject("select id::text from scenario where code = 'SC-01'", String.class);
        mvc.perform(post("/api/v1/scenarios/{id}/approve", sc1)).andExpect(status().isOk());
        String base = TARGET.baseUrl();
        mvc.perform(patch("/api/v1/projects/{id}", projectId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"targetUrl\":\"" + base + "\",\"testControlUrl\":\"" + base + "/api/test\","
                        + "\"queryApiBaseUrl\":\"" + base + "/api/test/query\"}")).andExpect(status().isOk());
        Fixtures.upload(mvc, projectId, "TEST_DATA", "seed.json",
                "{\"variables\":{\"memberEmail\":\"member@example.test\"},\"secrets\":{\"memberPassword\":\"pw-secret\"}}"
                        .getBytes(StandardCharsets.UTF_8)).andExpect(status().isCreated());
        AI.resetAll();
        RunStubs.happyPath(AI, RUNNER, TARGET);
    }

    private String run(ResultActions start) throws Exception {
        String runId = JsonPath.read(start.andExpect(status().isAccepted()).andReturn().getResponse()
                .getContentAsString(), "$.id");
        await().atMost(Duration.ofSeconds(30)).pollInterval(Duration.ofMillis(100)).until(() -> !List.of("PREPARING",
                "RUNNING", "CANCELLING").contains(jdbc.queryForObject("select status from test_run where id = ?::uuid",
                String.class, UUID.fromString(runId))));
        return runId;
    }

    private String startRun() throws Exception {
        return run(mvc.perform(post("/api/v1/test-requests/{id}/runs", requestId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"scenarioIds\":[\"" + sc1 + "\"]}")));
    }

    private ResultActions report(String runId) throws Exception {
        return mvc.perform(get("/api/v1/runs/{id}/report", runId));
    }

    private String caseId(String runId, String code) {
        return jdbc.queryForObject("select cr.id::text from case_result cr join scenario_run sr on sr.id = cr.scenario_run_id"
                + " join test_case tc on tc.id = cr.test_case_id where sr.run_id = ?::uuid and tc.code = ?", String.class,
                UUID.fromString(runId), code);
    }

    private void stubAnalysis(String result) {
        AI.stubFor(com.github.tomakehurst.wiremock.client.WireMock.post(urlEqualTo(ANALYSIS_PATH))
                .willReturn(aResponse().withStatus(202).withHeader("Content-Type", "application/json")
                        .withBody("{\"jobId\":\"fa-1\",\"type\":\"FAILURE_ANALYZE\",\"status\":\"QUEUED\"}")));
        AI.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo("/internal/v1/jobs/fa-1"))
                .willReturn(okJson(result)));
    }

    static String analysisResult(String severity) {
        return "{\"jobId\":\"fa-1\",\"type\":\"FAILURE_ANALYZE\",\"status\":\"SUCCEEDED\",\"result\":{\"kind\":\"FAILURE_ANALYZE\","
                + "\"severity\":\"" + severity + "\",\"affectedFeatures\":[\"장바구니\",\"주문\"],\"rootCauses\":["
                + "{\"rank\":2,\"description\":\"근거 없는 후보\",\"confidencePct\":30,\"evidence\":[]},"
                + "{\"rank\":1,\"description\":\"DB 수량이 화면·API와 다르게 저장됨\",\"confidencePct\":82,"
                + "\"evidence\":[\"DB 장바구니 수량 = 2, 화면·API = 3\"],\"remediation\":\"수량 저장 로직 확인\"},"
                + "{\"rank\":3,\"description\":\"초기화 데이터 차이\",\"confidencePct\":10,\"evidence\":[\"초기화 뒤 수량 2\"]}]},"
                + "\"error\":null}";
    }

    @Test
    void reportAggregatesAndCaseDetailWhileAnalysisPending() throws Exception {
        RunStubs.target(TARGET, 2);
        String runId = startRun();
        report(runId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.run.code").value("RUN-0001"))
                .andExpect(jsonPath("$.run.status").value("FAILED"))
                .andExpect(jsonPath("$.kpis.scenariosPassed").value(0))
                .andExpect(jsonPath("$.kpis.scenariosTotal").value(1))
                .andExpect(jsonPath("$.kpis.casesPassed").value(0))
                .andExpect(jsonPath("$.kpis.casesTotal").value(2))
                .andExpect(jsonPath("$.kpis.casePassRatePct").value(0))
                .andExpect(jsonPath("$.kpis.failedCases").value(2))
                .andExpect(jsonPath("$.kpis.errorCases").value(0))
                .andExpect(jsonPath("$.kpis.crossCheckMismatches").value(2))
                .andExpect(jsonPath("$.kpis.apiCallCount").value(6))
                .andExpect(jsonPath("$.kpis.durationMs").isNumber())
                .andExpect(jsonPath("$.scenarios[0].code").value("SC-01"))
                .andExpect(jsonPath("$.scenarios[0].passedCases").value(0))
                .andExpect(jsonPath("$.scenarios[0].totalCases").value(2))
                .andExpect(jsonPath("$.scenarios[0].cases[0].code").value("TC-01"))
                .andExpect(jsonPath("$.scenarios[0].cases[0].failedAttempts").value(3))
                .andExpect(jsonPath("$.skippedScenarios", hasSize(1)))
                .andExpect(jsonPath("$.skippedScenarios[0].code").value("SC-02"))
                .andExpect(jsonPath("$.skippedScenarios[0].status").value("GUARD_FAILED"))
                .andExpect(jsonPath("$.comparison.previousRunCode").isEmpty())
                .andExpect(jsonPath("$.comparison.newFailures", hasSize(0)));

        String tc1 = caseId(runId, "TC-01");
        mvc.perform(get("/api/v1/case-results/{id}", tc1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value("TC-01"))
                .andExpect(jsonPath("$.scenarioCode").value("SC-01"))
                .andExpect(jsonPath("$.requirementRef").value("FR-CART-01"))
                .andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.failureType").value("DATA_MISMATCH"))
                .andExpect(jsonPath("$.analysisStatus").value("PENDING"))
                .andExpect(jsonPath("$.rootCauses", hasSize(0)))
                .andExpect(jsonPath("$.severity").isEmpty())
                .andExpect(jsonPath("$.affectedFeatures", hasSize(0)))
                .andExpect(jsonPath("$.firstSeenRunCode").value("RUN-0001"))
                .andExpect(jsonPath("$.verifications[0].verdict").value("MISMATCH"))
                .andExpect(jsonPath("$.verifications[0].dbValue").value("2"))
                .andExpect(jsonPath("$.verifications[0].expectedValue").value("3"))
                .andExpect(jsonPath("$.reproductionSteps[0].attempt").value(3))
                .andExpect(jsonPath("$.reproductionSteps[5].kind").value("ASSERT"))
                .andExpect(jsonPath("$.reproductionSteps[5].status").value("FAILED"))
                .andExpect(jsonPath("$.artifacts[*].type", org.hamcrest.Matchers.hasItems("SCREENSHOT", "TRACE", "HAR")));
        assertThat(jdbc.queryForObject("select count(*) from async_job where type = 'FAILURE_ANALYZE'", Integer.class))
                .isEqualTo(2);
        assertThat(jdbc.queryForObject("select length(failure_fingerprint) from case_result where id = ?::uuid",
                Integer.class, UUID.fromString(tc1))).isEqualTo(64);
        mvc.perform(get("/api/v1/case-results/{id}", UUID.randomUUID())).andExpect(status().isNotFound());
        report(UUID.randomUUID().toString()).andExpect(status().isNotFound());
    }

    @Test
    void reportIsRejectedUntilRunFinishes() throws Exception {
        String runId = UUID.randomUUID().toString();
        jdbc.update("insert into test_run (id, project_id, test_request_id, seq, status, target_url) values (?::uuid,"
                + " ?::uuid, ?::uuid, 99, 'RUNNING', 'http://x')", UUID.fromString(runId), UUID.fromString(projectId),
                UUID.fromString(requestId));
        report(runId).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("RUN_NOT_FINISHED"));
        mvc.perform(post("/api/v1/runs/{id}/rerun", runId)).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RUN_NOT_FINISHED"));
    }

    @Test
    void analysisCompletesWithEvidenceBackedCandidatesOnly() throws Exception {
        RunStubs.target(TARGET, 2);
        String runId = startRun();
        String tc1 = caseId(runId, "TC-01");
        stubAnalysis(analysisResult("HIGH"));
        poller.pollOnce();
        mvc.perform(get("/api/v1/case-results/{id}", tc1)).andExpect(jsonPath("$.analysisStatus").value("RUNNING"));
        String body = AI.findAll(postRequestedFor(urlEqualTo(ANALYSIS_PATH))).get(0).getBodyAsString();
        assertThat((String) JsonPath.read(body, "$.failureType")).isEqualTo("DATA_MISMATCH");
        assertThat((String) JsonPath.read(body, "$.projectId")).isEqualTo(projectId);
        assertThat((Integer) JsonPath.read(body, "$.failedAttempts")).isEqualTo(3);
        assertThat((List<String>) JsonPath.read(body, "$.verifications[*].verdict")).contains("MISMATCH");
        assertThat((List<String>) JsonPath.read(body, "$.apiCalls[*].path")).contains("/api/cart/items");
        assertThat(body).doesNotContain("pw-secret");
        poller.pollOnce();
        mvc.perform(get("/api/v1/case-results/{id}", tc1))
                .andExpect(jsonPath("$.analysisStatus").value("COMPLETED"))
                .andExpect(jsonPath("$.severity").value("HIGH"))
                .andExpect(jsonPath("$.affectedFeatures[0]").value("장바구니"))
                .andExpect(jsonPath("$.rootCauses", hasSize(2)))
                .andExpect(jsonPath("$.rootCauses[0].rank").value(1))
                .andExpect(jsonPath("$.rootCauses[0].confidencePct").value(82))
                .andExpect(jsonPath("$.rootCauses[0].evidence[0]").value("DB 장바구니 수량 = 2, 화면·API = 3"))
                .andExpect(jsonPath("$.rootCauses[0].remediation").value("수량 저장 로직 확인"))
                .andExpect(jsonPath("$.rootCauses[1].rank").value(2))
                .andExpect(jsonPath("$.rootCauses[1].remediation").isEmpty())
                // AI 분석은 실패 유형을 바꾸지 않는다
                .andExpect(jsonPath("$.failureType").value("DATA_MISMATCH"));
    }

    @Test
    void analysisFailureIsRecordedAndInvalidResultRejected() throws Exception {
        RunStubs.target(TARGET, 2);
        String runId = startRun();
        stubAnalysis("{\"jobId\":\"fa-1\",\"type\":\"FAILURE_ANALYZE\",\"status\":\"FAILED\",\"result\":null,"
                + "\"error\":{\"code\":\"LLM_UNAVAILABLE\",\"message\":\"LLM 연결 실패\",\"retryable\":false}}");
        poller.pollOnce();
        poller.pollOnce();
        mvc.perform(get("/api/v1/case-results/{id}", caseId(runId, "TC-01")))
                .andExpect(jsonPath("$.analysisStatus").value("FAILED"))
                .andExpect(jsonPath("$.analysisError", containsString("LLM_UNAVAILABLE")))
                .andExpect(jsonPath("$.rootCauses", hasSize(0)));

        AI.resetAll();
        RunStubs.happyPath(AI, RUNNER, TARGET);
        RunStubs.target(TARGET, 2);
        String second = startRun();
        stubAnalysis(analysisResult("WRONG"));
        poller.pollOnce();
        poller.pollOnce();
        mvc.perform(get("/api/v1/case-results/{id}", caseId(second, "TC-01")))
                .andExpect(jsonPath("$.analysisStatus").value("FAILED"))
                .andExpect(jsonPath("$.analysisError", containsString("계약")));
    }

    @Test
    void passedCasesNeedNoAnalysis() throws Exception {
        String runId = startRun();
        report(runId).andExpect(jsonPath("$.kpis.casePassRatePct").value(100))
                .andExpect(jsonPath("$.kpis.scenariosPassed").value(1));
        mvc.perform(get("/api/v1/case-results/{id}", caseId(runId, "TC-01")))
                .andExpect(jsonPath("$.analysisStatus").value("NOT_REQUIRED"))
                .andExpect(jsonPath("$.firstSeenRunCode").isEmpty())
                .andExpect(jsonPath("$.reproductionSteps[0].attempt").value(1));
        assertThat(jdbc.queryForObject("select count(*) from async_job where type = 'FAILURE_ANALYZE'", Integer.class))
                .isZero();
    }

    @Test
    void rerunComparesWithOriginalAndTracksFirstSeen() throws Exception {
        RunStubs.target(TARGET, 2);
        String first = startRun();
        // 실패 그대로 재실행 → 계속 실패, 처음 발생은 RUN-0001
        AI.resetAll();
        RunStubs.happyPath(AI, RUNNER, TARGET);
        RunStubs.target(TARGET, 2);
        String second = run(mvc.perform(post("/api/v1/runs/{id}/rerun", first)));
        AI.verify(0, postRequestedFor(urlEqualTo(RunStubs.TQ_PATH)));
        mvc.perform(get("/api/v1/runs/{id}", second))
                .andExpect(jsonPath("$.code").value("RUN-0002"))
                .andExpect(jsonPath("$.rerunOfRunId").value(first));
        report(second)
                .andExpect(jsonPath("$.comparison.previousRunCode").value("RUN-0001"))
                .andExpect(jsonPath("$.comparison.continuingFailures", hasSize(2)))
                .andExpect(jsonPath("$.comparison.newFailures", hasSize(0)))
                .andExpect(jsonPath("$.comparison.previousCasePassRatePct").value(0));
        mvc.perform(get("/api/v1/case-results/{id}", caseId(second, "TC-01")))
                .andExpect(jsonPath("$.firstSeenRunCode").value("RUN-0001"));

        // 고친 뒤 TC-01 만 재실행 → 해결됨
        RunStubs.target(TARGET, 3);
        String third = run(mvc.perform(post("/api/v1/runs/{id}/rerun", second).contentType(MediaType.APPLICATION_JSON)
                .content("{\"caseResultIds\":[\"" + caseId(second, "TC-01") + "\"]}")));
        report(third)
                .andExpect(jsonPath("$.run.status").value("PASSED"))
                .andExpect(jsonPath("$.kpis.casesTotal").value(1))
                .andExpect(jsonPath("$.comparison.previousRunCode").value("RUN-0002"))
                .andExpect(jsonPath("$.comparison.resolved[0]").value("TC-01"));
        // 원래 요청의 다음 일반 실행은 같은 요청의 가장 최근 끝난 실행(RUN-0003)과 비교
        RunStubs.target(TARGET, 2);
        String fourth = startRun();
        report(fourth)
                .andExpect(jsonPath("$.comparison.previousRunCode").value("RUN-0003"))
                .andExpect(jsonPath("$.comparison.newFailures", hasSize(2)));
        mvc.perform(get("/api/v1/case-results/{id}", caseId(fourth, "TC-01")))
                .andExpect(jsonPath("$.firstSeenRunCode").value("RUN-0004"));
    }

    @Test
    void firstSeenChainsFromRunWithoutStoredFingerprint() throws Exception {
        RunStubs.target(TARGET, 2);
        String first = startRun();
        // M4 전에 끝난 실행처럼 지문과 처음 발생을 지운다
        jdbc.update("update case_result set failure_fingerprint = null, first_seen_run_id = null");
        AI.resetAll();
        RunStubs.happyPath(AI, RUNNER, TARGET);
        RunStubs.target(TARGET, 2);
        String second = run(mvc.perform(post("/api/v1/runs/{id}/rerun", first)));
        mvc.perform(get("/api/v1/case-results/{id}", caseId(second, "TC-01")))
                .andExpect(jsonPath("$.firstSeenRunCode").value("RUN-0001"));
    }

    @Test
    void rerunValidation() throws Exception {
        String passed = startRun();
        mvc.perform(post("/api/v1/runs/{id}/rerun", passed)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        mvc.perform(post("/api/v1/runs/{id}/rerun", passed).contentType(MediaType.APPLICATION_JSON)
                .content("{\"caseResultIds\":[\"" + UUID.randomUUID() + "\"]}")).andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/runs/{id}/rerun", UUID.randomUUID())).andExpect(status().isNotFound());
        // 통과한 케이스도 지정하면 재실행할 수 있다
        String tc2 = caseId(passed, "TC-02");
        mvc.perform(patch("/api/v1/scenarios/{id}", sc1).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"승인 해제\"}")).andExpect(status().isOk());
        mvc.perform(post("/api/v1/runs/{id}/rerun", passed).contentType(MediaType.APPLICATION_JSON)
                .content("{\"caseResultIds\":[\"" + tc2 + "\"]}")).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SCENARIO_NOT_APPROVED"));
        mvc.perform(post("/api/v1/scenarios/{id}/approve", sc1)).andExpect(status().isOk());
        jdbc.update("insert into test_run (project_id, test_request_id, seq, status, target_url) values (?::uuid, ?::uuid,"
                + " 98, 'RUNNING', 'http://x')", UUID.fromString(projectId), UUID.fromString(requestId));
        mvc.perform(post("/api/v1/runs/{id}/rerun", passed).contentType(MediaType.APPLICATION_JSON)
                .content("{\"caseResultIds\":[\"" + tc2 + "\"]}")).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RUN_ALREADY_ACTIVE"));
    }
}
