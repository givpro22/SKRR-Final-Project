package com.skrr.platform.request;

import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.skrr.platform.common.job.AsyncJobPoller;
import com.skrr.platform.support.AiStubs;
import com.skrr.platform.support.Fixtures;
import com.skrr.platform.support.IntegrationTest;
import com.skrr.platform.support.M2Flow;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/** FR-02 요청 정제, 후보 선택, 첫 시나리오 생성 (TestRequest 상태 전이). */
class TestRequestIntegrationTest extends IntegrationTest {

    @Autowired
    AsyncJobPoller poller;

    M2Flow flow;

    @BeforeEach
    void setUp() {
        flow = new M2Flow(mvc, jdbc, AI, poller);
    }

    private ResultActions create(String projectId, String body) throws Exception {
        return mvc.perform(post("/api/v1/projects/{id}/test-requests", projectId)
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private ResultActions getRequest(String id) throws Exception {
        return mvc.perform(get("/api/v1/test-requests/{id}", id));
    }

    @Test
    void rejectsWhenKnowledgeBaseNotReadyOrTextInvalid() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        create(projectId, "{\"text\":\"장바구니\"}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("KNOWLEDGE_BASE_NOT_READY"));
        jdbc.update("update knowledge_base set status = 'STALE' where project_id = ?::uuid", UUID.fromString(projectId));
        create(projectId, "{\"text\":\"장바구니\"}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("KNOWLEDGE_BASE_NOT_READY"))
                .andExpect(jsonPath("$.detail", containsString("다시 구축")));
        jdbc.update("update knowledge_base set status = 'READY' where project_id = ?::uuid", UUID.fromString(projectId));
        create(projectId, "{\"text\":\"   \"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.fieldErrors[0].field").value("text"));
        create(projectId, "{\"text\":\"" + "가".repeat(501) + "\"}").andExpect(status().isBadRequest());
        create(projectId, "{}").andExpect(status().isBadRequest());
        create(projectId, "{\"text\":\"  " + "가".repeat(500) + "  \"}").andExpect(status().isAccepted());
        create(UUID.randomUUID().toString(), "{\"text\":\"a\"}").andExpect(status().isNotFound());
        assertThat(jdbc.queryForObject("select count(*) from test_request", Integer.class)).isEqualTo(1);
    }

    @Test
    void refineSelectGenerateFlow() throws Exception {
        String projectId = flow.readyProject();
        String json = create(projectId, "{\"text\":\"  장바구니에 담으면 수량이 맞는지  \"}")
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.code").value("REQ-0001"))
                .andExpect(jsonPath("$.status").value("REFINING"))
                .andExpect(jsonPath("$.rawText").value("장바구니에 담으면 수량이 맞는지"))
                .andExpect(jsonPath("$.candidates", hasSize(0)))
                .andExpect(jsonPath("$.scenarioCount").value(0))
                .andExpect(jsonPath("$.selectionSource").isEmpty())
                .andReturn().getResponse().getContentAsString();
        String requestId = JsonPath.read(json, "$.id");
        create(projectId, "{\"text\":\"두 번째\"}").andExpect(jsonPath("$.code").value("REQ-0002"));

        List<String> candidates = flow.refine(requestId, "job-r1");
        String refineBody = AI.findAll(postRequestedFor(urlEqualTo(AiStubs.REFINE_PATH))).get(0).getBodyAsString();
        Map<String, Object> sent = JsonPath.read(refineBody, "$");
        assertThat(sent).containsEntry("projectId", projectId).containsEntry("text", "장바구니에 담으면 수량이 맞는지")
                .containsEntry("candidateCount", 4).containsEntry("topK", 3);
        getRequest(requestId)
                .andExpect(jsonPath("$.status").value("AWAITING_SELECTION"))
                .andExpect(jsonPath("$.candidates", hasSize(3)))
                .andExpect(jsonPath("$.candidates[0].order").value(1))
                .andExpect(jsonPath("$.candidates[0].refinedText").value("장바구니 담기 후보 1"))
                .andExpect(jsonPath("$.candidates[0].references[0].sourceId").value("FR-CART-01"))
                .andExpect(jsonPath("$.candidates[0].references[0].score").value(0.9));

        flow.select(requestId, candidates.get(1));
        getRequest(requestId)
                .andExpect(jsonPath("$.status").value("GENERATING"))
                .andExpect(jsonPath("$.selectionSource").value("CANDIDATE"))
                .andExpect(jsonPath("$.selectedText").value("장바구니 담기 후보 2"));
        mvc.perform(post("/api/v1/test-requests/{id}/selection", requestId).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"candidateId\":\"" + candidates.get(0) + "\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE_TRANSITION"));
        assertThat(jdbc.queryForObject("select count(*) from request_candidate where is_selected", Integer.class))
                .isEqualTo(1);

        flow.generate("job-g1", AiStubs.generation(AiStubs.scenario("SC-01", true, "TC-01", "TC-02"),
                AiStubs.scenario("SC-02", false, "TC-03")));
        String genBody = AI.findAll(postRequestedFor(urlEqualTo(AiStubs.GENERATE_PATH))).get(0).getBodyAsString();
        assertThat((String) JsonPath.read(genBody, "$.testRequestCode")).isEqualTo("REQ-0001");
        assertThat((String) JsonPath.read(genBody, "$.requestText")).isEqualTo("장바구니 담기 후보 2");
        assertThat((Integer) JsonPath.read(genBody, "$.firstScenarioNumber")).isEqualTo(1);
        assertThat((Integer) JsonPath.read(genBody, "$.firstCaseNumber")).isEqualTo(1);
        assertThat((Object) JsonPath.read(genBody, "$.regenerate")).isNull();

        getRequest(requestId)
                .andExpect(jsonPath("$.status").value("GENERATED"))
                .andExpect(jsonPath("$.scenarioCount").value(2))
                .andExpect(jsonPath("$.testCaseCount").value(3));
        mvc.perform(get("/api/v1/test-requests/{id}/scenarios", requestId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.testRequest.code").value("REQ-0001"))
                .andExpect(jsonPath("$.summary.total").value(2))
                .andExpect(jsonPath("$.summary.reviewRequired").value(1))
                .andExpect(jsonPath("$.summary.guardFailed").value(1))
                .andExpect(jsonPath("$.summary.approved").value(0))
                .andExpect(jsonPath("$.summary.generating").value(0))
                .andExpect(jsonPath("$.items[0].code").value("SC-01"))
                .andExpect(jsonPath("$.items[0].status").value("REVIEW_REQUIRED"))
                .andExpect(jsonPath("$.items[0].guard.attempt").value(1))
                .andExpect(jsonPath("$.items[0].guard.maxAttempts").value(3))
                .andExpect(jsonPath("$.items[0].guard.catalogGap").value(false))
                .andExpect(jsonPath("$.items[0].guard.failures", hasSize(0)))
                .andExpect(jsonPath("$.items[0].scopes[2]").value("DB"))
                .andExpect(jsonPath("$.items[0].caseCount").value(2))
                .andExpect(jsonPath("$.items[0].testCases[1].code").value("TC-02"))
                .andExpect(jsonPath("$.items[0].testCases[1].order").value(2))
                .andExpect(jsonPath("$.items[0].testCases[0].isActive").value(true))
                .andExpect(jsonPath("$.items[0].testCases[0].expectedValues[0].expected").value("3"))
                .andExpect(jsonPath("$.items[0].testCases[0].expectedValues[1].consistencyOnly").value(true))
                .andExpect(jsonPath("$.items[1].status").value("GUARD_FAILED"))
                .andExpect(jsonPath("$.items[1].guard.attempt").value(3))
                .andExpect(jsonPath("$.items[1].guard.catalogGap").value(true))
                .andExpect(jsonPath("$.items[1].guard.message", containsString("cart-remove-button")))
                .andExpect(jsonPath("$.items[1].guard.failures[1].kind").value("CATALOG_GAP"))
                .andExpect(jsonPath("$.items[1].guard.failures[1].subject").value("cart-remove-button"));
        mvc.perform(get("/api/v1/projects/{id}/activities", projectId))
                .andExpect(jsonPath("$.items[0].message").value("REQ-0001 시나리오 2개 · 테스트 케이스 3개 생성"));
    }

    @Test
    void selectionValidation() throws Exception {
        String projectId = flow.readyProject();
        String requestId = flow.createRequest(projectId, "요청 A");
        String otherId = flow.createRequest(projectId, "요청 B");
        mvc.perform(post("/api/v1/test-requests/{id}/selection", requestId).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"customText\":\"직접\"}"))
                .andExpect(status().isConflict());
        List<String> candidates = flow.refine(requestId, "job-a");
        AI.resetAll();
        List<String> otherCandidates = flow.refine(otherId, "job-b");

        mvc.perform(post("/api/v1/test-requests/{id}/selection", requestId).contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        mvc.perform(post("/api/v1/test-requests/{id}/selection", requestId).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"candidateId\":\"" + candidates.get(0) + "\",\"customText\":\"x\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/test-requests/{id}/selection", requestId).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"candidateId\":\"" + otherCandidates.get(0) + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[0].field").value("candidateId"));
        mvc.perform(post("/api/v1/test-requests/{id}/selection", requestId).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"customText\":\"   \"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/test-requests/{id}/selection", requestId).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"customText\":\"  직접 입력한 요청  \"}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("GENERATING"))
                .andExpect(jsonPath("$.selectionSource").value("CUSTOM"))
                .andExpect(jsonPath("$.selectedText").value("직접 입력한 요청"));
        mvc.perform(post("/api/v1/test-requests/{id}/selection", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"customText\":\"x\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void refinementFailuresEndInFailed() throws Exception {
        String projectId = flow.readyProject();
        String kbMissing = flow.createRequest(projectId, "A");
        String empty = flow.createRequest(projectId, "B");
        AiStubs.accept(AI, AiStubs.REFINE_PATH, "job-x", "REQUEST_REFINE");
        poller.pollOnce();
        // 스텁이 두 요청에 같은 원격 작업 ID를 주므로 두 요청 모두 같은 실패로 끝난다
        AiStubs.job(AI, "job-x", AiStubs.failed("job-x", "REQUEST_REFINE", "KNOWLEDGE_BASE_MISSING", false));
        poller.pollOnce();
        getRequest(kbMissing)
                .andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.errorMessage", containsString("지식 베이스를 다시 구축해 주세요")));
        getRequest(empty).andExpect(jsonPath("$.status").value("FAILED"));
        mvc.perform(post("/api/v1/test-requests/{id}/selection", kbMissing).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"customText\":\"x\"}"))
                .andExpect(status().isConflict());

        String noCandidates = flow.createRequest(projectId, "C");
        AiStubs.accept(AI, AiStubs.REFINE_PATH, "job-y", "REQUEST_REFINE");
        poller.pollOnce();
        AiStubs.job(AI, "job-y", AiStubs.succeeded("job-y", "REQUEST_REFINE", AiStubs.refinement(0)));
        poller.pollOnce();
        getRequest(noCandidates)
                .andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.errorMessage", containsString("후보를 만들지 못했습니다")));
    }

    @Test
    void invalidGenerationResultFailsRequestWithoutPartialSave() throws Exception {
        String projectId = flow.readyProject();
        String requestId = flow.createRequest(projectId, "장바구니");
        List<String> candidates = flow.refine(requestId, "job-r");
        flow.select(requestId, candidates.get(0));
        String noExpected = AiStubs.scenario("SC-02", true, "TC-02").replaceAll(",\"expectedValues\":\\[[^\\]]*\\]", "");
        flow.generate("job-g", AiStubs.generation(AiStubs.scenario("SC-01", true, "TC-01"), noExpected));
        getRequest(requestId)
                .andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.errorMessage", containsString("expectedValues")))
                .andExpect(jsonPath("$.scenarioCount").value(0));
        assertThat(jdbc.queryForObject("select count(*) from scenario", Integer.class)).isZero();

        String dup = flow.createRequest(projectId, "중복 코드");
        AI.resetAll();
        List<String> c2 = flow.refine(dup, "job-r2");
        flow.select(dup, c2.get(0));
        flow.generate("job-g2", AiStubs.generation(AiStubs.scenario("SC-01", true, "TC-01"),
                AiStubs.scenario("SC-02", true, "TC-01")));
        getRequest(dup).andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.errorMessage", containsString("TC 번호")));
    }

    @Test
    void generationAiFailureEndsInFailed() throws Exception {
        String projectId = flow.readyProject();
        String requestId = flow.createRequest(projectId, "장바구니");
        List<String> candidates = flow.refine(requestId, "job-r");
        flow.select(requestId, candidates.get(0));
        AiStubs.accept(AI, AiStubs.GENERATE_PATH, "job-g", "SCENARIO_GENERATE");
        poller.pollOnce();
        AiStubs.job(AI, "job-g", AiStubs.failed("job-g", "SCENARIO_GENERATE", "LLM_UNAVAILABLE", false));
        poller.pollOnce();
        getRequest(requestId)
                .andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.errorMessage", containsString("LLM_UNAVAILABLE")));
    }

    @Test
    void listIsNewestFirstWithCursor() throws Exception {
        String projectId = flow.readyProject();
        for (int i = 1; i <= 3; i++) {
            flow.createRequest(projectId, "요청 " + i);
        }
        String page1 = mvc.perform(get("/api/v1/projects/{id}/test-requests?limit=2", projectId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.items[0].code").value("REQ-0003"))
                .andExpect(jsonPath("$.nextCursor").value("2"))
                .andReturn().getResponse().getContentAsString();
        String cursor = JsonPath.read(page1, "$.nextCursor");
        mvc.perform(get("/api/v1/projects/{id}/test-requests?limit=2&cursor=" + cursor, projectId))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].code").value("REQ-0001"))
                .andExpect(jsonPath("$.nextCursor").isEmpty());
        mvc.perform(get("/api/v1/projects/{id}/test-requests?cursor=abc", projectId))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/projects/{id}/test-requests?limit=201", projectId))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/projects/{id}/test-requests", UUID.randomUUID())).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/test-requests/{id}", UUID.randomUUID())).andExpect(status().isNotFound());
    }
}
