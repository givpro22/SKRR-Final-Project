package com.skrr.platform.scenario;

import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.skrr.platform.common.job.AsyncJobPoller;
import com.skrr.platform.support.AiStubs;
import com.skrr.platform.support.IntegrationTest;
import com.skrr.platform.support.M2Flow;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/** FR-03 시나리오·케이스 수정, 승인·반려, 재생성 (Scenario 상태 전이, 승인 해제, TC 번호). */
class ScenarioIntegrationTest extends IntegrationTest {

    @Autowired
    AsyncJobPoller poller;

    M2Flow flow;
    String requestId;
    String sc1;
    String sc2;

    @BeforeEach
    void setUp() throws Exception {
        flow = new M2Flow(mvc, jdbc, AI, poller);
        requestId = flow.generatedRequest();
        sc1 = scenarioId("SC-01");
        sc2 = scenarioId("SC-02");
        AI.resetAll();
    }

    private String scenarioId(String code) {
        return jdbc.queryForObject("select id::text from scenario where code = ?", String.class, code);
    }

    private String caseId(String code) {
        return jdbc.queryForObject("select id::text from test_case where code = ?", String.class, code);
    }

    private ResultActions action(String scenarioId, String action) throws Exception {
        return mvc.perform(post("/api/v1/scenarios/{id}/" + action, scenarioId));
    }

    private ResultActions getScenario(String id) throws Exception {
        return mvc.perform(get("/api/v1/scenarios/{id}", id));
    }

    private ResultActions patchScenario(String id, String body) throws Exception {
        return mvc.perform(patch("/api/v1/scenarios/{id}", id).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private ResultActions patchCase(String id, String body) throws Exception {
        return mvc.perform(patch("/api/v1/test-cases/{id}", id).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private ResultActions regenerate(String id, String body) throws Exception {
        return mvc.perform(post("/api/v1/scenarios/{id}/regenerate", id)
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    @Test
    void approveRejectFollowStateTable() throws Exception {
        action(sc1, "approve")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.approvedAt").isString());
        action(sc1, "approve").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE_TRANSITION"));
        action(sc1, "reject").andExpect(status().isConflict());
        action(sc2, "approve").andExpect(status().isConflict());
        action(sc2, "reject").andExpect(status().isConflict());
        assertThat(jdbc.queryForObject("select approved_by::text from scenario where id = ?::uuid", String.class, sc1))
                .isEqualTo("00000000-0000-0000-0000-000000000001");

        String sc1Id = sc1;
        mvc.perform(get("/api/v1/test-requests/{id}/scenarios", requestId))
                .andExpect(jsonPath("$.summary.approved").value(1))
                .andExpect(jsonPath("$.summary.guardFailed").value(1));
        // 승인 후 내용 수정 → 승인 해제, version 증가
        patchScenario(sc1Id, "{\"title\":\"새 제목\",\"requirementRef\":\"FR-CART-02\",\"scopes\":[\"UI\"]}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REVIEW_REQUIRED"))
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.approvedAt").isEmpty())
                .andExpect(jsonPath("$.title").value("새 제목"))
                .andExpect(jsonPath("$.scopes", hasSize(1)));
        patchScenario(sc1Id, "{\"title\":\"새 제목\"}").andExpect(jsonPath("$.version").value(2));
        action(sc1Id, "reject").andExpect(status().isOk()).andExpect(jsonPath("$.status").value("REJECTED"));
        patchScenario(sc1Id, "{\"title\":\"반려 후 수정\"}")
                .andExpect(jsonPath("$.status").value("REVIEW_REQUIRED"))
                .andExpect(jsonPath("$.version").value(3));
        patchScenario(sc1Id, "{\"title\":\"\"}").andExpect(status().isBadRequest());
        patchScenario(sc1Id, "{\"requirementRef\":\"" + "x".repeat(51) + "\"}").andExpect(status().isBadRequest());
        patchScenario(sc1Id, "{\"scopes\":[\"WEB\"]}").andExpect(status().isBadRequest());
        // GUARD_FAILED 도 수정하면 REVIEW_REQUIRED (동작 표)
        patchScenario(sc2, "{\"title\":\"사람이 고친 시나리오\"}").andExpect(jsonPath("$.status").value("REVIEW_REQUIRED"));
        action(UUID.randomUUID().toString(), "approve").andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/projects/{id}/activities", jdbc.queryForObject(
                        "select project_id::text from test_request where id = ?::uuid", String.class, requestId)))
                .andExpect(jsonPath("$.items[0].message").value("REQ-0001 SC-02 시나리오 수정 (v2)"));
    }

    @Test
    void requirementRefNullClearsAndAbsentKeeps() throws Exception {
        action(sc1, "approve").andExpect(status().isOk());
        patchScenario(sc1, "{\"title\":\"SC-01 장바구니 담기\"}")
                .andExpect(jsonPath("$.requirementRef").value("FR-CART-01"))
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.status").value("APPROVED"));
        patchScenario(sc1, "{\"requirementRef\":null}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requirementRef").isEmpty())
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.status").value("REVIEW_REQUIRED"));
        assertThat(jdbc.queryForObject("select requirement_ref from scenario where id = ?::uuid", String.class, sc1))
                .isNull();
        patchScenario(sc1, "{\"requirementRef\":null}").andExpect(jsonPath("$.version").value(2));
        patchScenario(sc1, "{\"requirementRef\":\"FR-ORD-01\"}")
                .andExpect(jsonPath("$.requirementRef").value("FR-ORD-01"))
                .andExpect(jsonPath("$.version").value(3));
        patchScenario(sc1, "{\"scopes\":[\"API\"]}")
                .andExpect(jsonPath("$.requirementRef").value("FR-ORD-01"))
                .andExpect(jsonPath("$.version").value(4));
    }

    @Test
    void testCaseEditValidatesExpectedValuesAndReleasesApproval() throws Exception {
        String tc1 = caseId("TC-01");
        action(sc1, "approve").andExpect(status().isOk());
        patchCase(tc1, "{\"expectedValues\":[]}").andExpect(status().isBadRequest());
        patchCase(tc1, "{\"expectedValues\":[{\"label\":\"수량\"}]}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("expectedValues[0]"));
        patchCase(tc1, "{\"expectedValues\":[{\"label\":\"수량\",\"expected\":\"3\",\"consistencyOnly\":true,\"reason\":\"r\"}]}")
                .andExpect(status().isBadRequest());
        patchCase(tc1, "{\"expectedValues\":[{\"label\":\"주문 번호\",\"consistencyOnly\":true}]}")
                .andExpect(status().isBadRequest());
        patchCase(tc1, "{\"type\":\"WRONG\"}").andExpect(status().isBadRequest());
        getScenario(sc1).andExpect(jsonPath("$.status").value("APPROVED"));

        patchCase(tc1, "{\"expectedValues\":[{\"label\":\"수량\",\"expected\":\"5\"}],\"steps\":[\"담기\"],\"type\":\"BOUNDARY\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.type").value("BOUNDARY"))
                .andExpect(jsonPath("$.expectedValues", hasSize(1)))
                .andExpect(jsonPath("$.expectedValues[0].expected").value("5"))
                .andExpect(jsonPath("$.expectedValues[0].consistencyOnly").doesNotExist());
        getScenario(sc1)
                .andExpect(jsonPath("$.status").value("REVIEW_REQUIRED"))
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.approvedAt").isEmpty());
        patchCase(tc1, "{\"type\":\"BOUNDARY\"}").andExpect(jsonPath("$.version").value(2));
        mvc.perform(get("/api/v1/test-cases/{id}", tc1)).andExpect(status().isOk())
                .andExpect(jsonPath("$.steps[0]").value("담기"));
        mvc.perform(get("/api/v1/test-cases/{id}", UUID.randomUUID())).andExpect(status().isNotFound());
    }

    @Test
    void regenerateReplacesCasesWithNewNumbersAndShowsGuardRetry() throws Exception {
        action(sc1, "approve").andExpect(status().isOk());
        regenerate(sc1, "{\"feedback\":\"예외 케이스를 추가해 주세요\"}")
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("GENERATING"))
                .andExpect(jsonPath("$.approvedAt").isEmpty());
        regenerate(sc1, "{}").andExpect(status().isConflict());
        patchScenario(sc1, "{\"title\":\"x\"}").andExpect(status().isConflict());
        patchCase(caseId("TC-01"), "{\"title\":\"x\"}").andExpect(status().isConflict());
        action(sc1, "approve").andExpect(status().isConflict());

        AiStubs.accept(AI, AiStubs.GENERATE_PATH, "job-re", "SCENARIO_GENERATE");
        poller.pollOnce();
        String body = AI.findAll(postRequestedFor(urlEqualTo(AiStubs.GENERATE_PATH))).get(0).getBodyAsString();
        assertThat((Integer) JsonPath.read(body, "$.firstScenarioNumber")).isEqualTo(1);
        assertThat((Integer) JsonPath.read(body, "$.firstCaseNumber")).isEqualTo(4);
        assertThat((String) JsonPath.read(body, "$.regenerate.scenarioCode")).isEqualTo("SC-01");
        assertThat((String) JsonPath.read(body, "$.regenerate.feedback")).isEqualTo("예외 케이스를 추가해 주세요");
        List<String> previousCases = JsonPath.read(body, "$.regenerate.previous.testCases[*].code");
        assertThat(previousCases).containsExactly("TC-01", "TC-02");
        assertThat((Boolean) JsonPath.read(body, "$.regenerate.previous.guard.passed")).isTrue();

        AiStubs.job(AI, "job-re", "{\"jobId\":\"job-re\",\"type\":\"SCENARIO_GENERATE\",\"status\":\"RUNNING\","
                + "\"progress\":{\"phase\":\"GUARD\",\"attempt\":2,\"maxAttempts\":3,\"scenarioCode\":\"SC-01\","
                + "\"message\":\"카탈로그에 'cart-x' 요소가 없어 재생성 중\"}}");
        poller.pollOnce();
        getScenario(sc1)
                .andExpect(jsonPath("$.status").value("GUARD_RETRY"))
                .andExpect(jsonPath("$.guard.attempt").value(2))
                .andExpect(jsonPath("$.guard.message").value("카탈로그에 'cart-x' 요소가 없어 재생성 중"));
        mvc.perform(get("/api/v1/test-requests/{id}/scenarios", requestId))
                .andExpect(jsonPath("$.summary.guardRetry").value(1));

        AiStubs.job(AI, "job-re", AiStubs.succeeded("job-re", "SCENARIO_GENERATE",
                AiStubs.generation(AiStubs.scenario("SC-01", true, "TC-04", "TC-05", "TC-06"))));
        poller.pollOnce();
        getScenario(sc1)
                .andExpect(jsonPath("$.status").value("REVIEW_REQUIRED"))
                .andExpect(jsonPath("$.code").value("SC-01"))
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.caseCount").value(3))
                .andExpect(jsonPath("$.testCases[0].code").value("TC-04"))
                .andExpect(jsonPath("$.guard.failures", hasSize(0)));
        mvc.perform(get("/api/v1/test-cases/{id}", caseId("TC-01"))).andExpect(jsonPath("$.isActive").value(false));
        patchCase(caseId("TC-01"), "{\"title\":\"x\"}").andExpect(status().isConflict());
        mvc.perform(get("/api/v1/test-requests/{id}", requestId)).andExpect(jsonPath("$.testCaseCount").value(4));
        mvc.perform(get("/api/v1/test-requests/{id}/scenarios", requestId))
                .andExpect(jsonPath("$.items[0].testCases", hasSize(3)));

        // 두 번째 재생성: 번호는 비활성 포함 최댓값 + 1
        regenerate(sc1, "{}").andExpect(status().isAccepted());
        AI.resetAll();
        AiStubs.accept(AI, AiStubs.GENERATE_PATH, "job-re2", "SCENARIO_GENERATE");
        poller.pollOnce();
        String body2 = AI.findAll(postRequestedFor(urlEqualTo(AiStubs.GENERATE_PATH))).get(0).getBodyAsString();
        assertThat((Integer) JsonPath.read(body2, "$.firstCaseNumber")).isEqualTo(7);
        // 의견이 없으면 feedback 을 보내지 않는다
        assertThat(body2).doesNotContain("\"feedback\"");
    }

    @Test
    void regenerationResultReusingOldNumberIsRejectedAndKeepsOldContent() throws Exception {
        regenerate(sc1, "{}").andExpect(status().isAccepted());
        AiStubs.accept(AI, AiStubs.GENERATE_PATH, "job-bad", "SCENARIO_GENERATE");
        poller.pollOnce();
        AiStubs.job(AI, "job-bad", AiStubs.succeeded("job-bad", "SCENARIO_GENERATE",
                AiStubs.generation(AiStubs.scenario("SC-01", true, "TC-02"))));
        poller.pollOnce();
        getScenario(sc1)
                .andExpect(jsonPath("$.status").value("REVIEW_REQUIRED"))
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.caseCount").value(2))
                .andExpect(jsonPath("$.guard.message", containsString("재생성 실패")));

        regenerate(sc1, "{}").andExpect(status().isAccepted());
        AI.resetAll();
        AiStubs.accept(AI, AiStubs.GENERATE_PATH, "job-wrong", "SCENARIO_GENERATE");
        poller.pollOnce();
        AiStubs.job(AI, "job-wrong", AiStubs.succeeded("job-wrong", "SCENARIO_GENERATE",
                AiStubs.generation(AiStubs.scenario("SC-09", true, "TC-09"))));
        poller.pollOnce();
        getScenario(sc1).andExpect(jsonPath("$.status").value("REVIEW_REQUIRED"))
                .andExpect(jsonPath("$.guard.message", containsString("SC-01")));
    }

    @Test
    void regenerationFailureKeepsGuardOutcome() throws Exception {
        regenerate(sc2, "{}").andExpect(status().isAccepted());
        AiStubs.accept(AI, AiStubs.GENERATE_PATH, "job-f", "SCENARIO_GENERATE");
        poller.pollOnce();
        AiStubs.job(AI, "job-f", AiStubs.failed("job-f", "SCENARIO_GENERATE", "LLM_TIMEOUT", false));
        poller.pollOnce();
        // 이전 내용이 가드 실패였으므로 GUARD_FAILED 로 돌아간다 (검토 안 된 내용을 승인 가능 상태로 두지 않음)
        getScenario(sc2)
                .andExpect(jsonPath("$.status").value("GUARD_FAILED"))
                .andExpect(jsonPath("$.guard.catalogGap").value(true))
                .andExpect(jsonPath("$.guard.message", containsString("LLM_TIMEOUT")));

        regenerate(sc2, "{}").andExpect(status().isAccepted());
        AI.resetAll();
        AiStubs.accept(AI, AiStubs.GENERATE_PATH, "job-g", "SCENARIO_GENERATE");
        poller.pollOnce();
        AiStubs.job(AI, "job-g", AiStubs.succeeded("job-g", "SCENARIO_GENERATE",
                AiStubs.generation(AiStubs.scenario("SC-02", false, "TC-04"))));
        poller.pollOnce();
        getScenario(sc2)
                .andExpect(jsonPath("$.status").value("GUARD_FAILED"))
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.guard.attempt").value(3))
                .andExpect(jsonPath("$.testCases[0].code").value("TC-04"));

        regenerate(sc2, "{}").andExpect(status().isAccepted());
        AI.resetAll();
        AiStubs.accept(AI, AiStubs.GENERATE_PATH, "job-ok", "SCENARIO_GENERATE");
        poller.pollOnce();
        AiStubs.job(AI, "job-ok", AiStubs.succeeded("job-ok", "SCENARIO_GENERATE",
                AiStubs.generation(AiStubs.scenario("SC-02", true, "TC-05"))));
        poller.pollOnce();
        getScenario(sc2)
                .andExpect(jsonPath("$.status").value("REVIEW_REQUIRED"))
                .andExpect(jsonPath("$.guard.catalogGap").value(false));
        action(sc2, "approve").andExpect(status().isOk());
    }

    @Test
    void feedbackSurvivesLostJobResubmission() throws Exception {
        regenerate(sc1, "{\"feedback\":\"경계값 케이스\"}").andExpect(status().isAccepted());
        assertThat(jdbc.queryForObject("select request_payload->>'feedback' from async_job where subject_type = 'SCENARIO'",
                String.class)).isEqualTo("경계값 케이스");
        AiStubs.accept(AI, AiStubs.GENERATE_PATH, "job-lost", "SCENARIO_GENERATE");
        poller.pollOnce();
        AI.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo("/internal/v1/jobs/job-lost"))
                .willReturn(com.github.tomakehurst.wiremock.client.WireMock.aResponse().withStatus(404)));
        poller.pollOnce();
        poller.pollOnce();
        List<com.github.tomakehurst.wiremock.verification.LoggedRequest> sent =
                AI.findAll(postRequestedFor(urlEqualTo(AiStubs.GENERATE_PATH)));
        assertThat(sent).hasSize(2);
        assertThat((String) JsonPath.read(sent.get(1).getBodyAsString(), "$.regenerate.feedback")).isEqualTo("경계값 케이스");
    }

    @Test
    void regenerateBodyIsOptionalAndFeedbackLimited() throws Exception {
        mvc.perform(post("/api/v1/scenarios/{id}/regenerate", sc1)).andExpect(status().isAccepted());
        regenerate(sc2, "{\"feedback\":\"" + "가".repeat(501) + "\"}").andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/scenarios/{id}/regenerate", UUID.randomUUID())).andExpect(status().isNotFound());
    }
}
