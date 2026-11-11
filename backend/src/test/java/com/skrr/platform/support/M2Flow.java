package com.skrr.platform.support;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.github.tomakehurst.wiremock.WireMockServer;
import com.jayway.jsonpath.JsonPath;
import com.skrr.platform.common.job.AsyncJobPoller;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

/** 요청 생성 → 정제 → 선택 → 생성까지 진행하는 도우미. */
public record M2Flow(MockMvc mvc, JdbcTemplate jdbc, WireMockServer ai, AsyncJobPoller poller) {

    public String readyProject() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        jdbc.update("update knowledge_base set status = 'READY', chunk_count = 10 where project_id = ?::uuid",
                java.util.UUID.fromString(projectId));
        return projectId;
    }

    public String createRequest(String projectId, String text) throws Exception {
        String json = mvc.perform(post("/api/v1/projects/{id}/test-requests", projectId)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"" + text + "\"}"))
                .andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(json, "$.id");
    }

    /** 정제까지 끝내고 첫 후보 id 를 돌려준다. */
    public List<String> refine(String requestId, String jobId) throws Exception {
        AiStubs.accept(ai, AiStubs.REFINE_PATH, jobId, "REQUEST_REFINE");
        poller.pollOnce();
        AiStubs.job(ai, jobId, AiStubs.succeeded(jobId, "REQUEST_REFINE", AiStubs.refinement(3)));
        poller.pollOnce();
        String json = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .get("/api/v1/test-requests/{id}", requestId))
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(json, "$.candidates[*].id");
    }

    public void select(String requestId, String candidateId) throws Exception {
        mvc.perform(post("/api/v1/test-requests/{id}/selection", requestId)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"candidateId\":\"" + candidateId + "\"}"))
                .andExpect(status().isAccepted());
    }

    public void generate(String jobId, String result) {
        AiStubs.accept(ai, AiStubs.GENERATE_PATH, jobId, "SCENARIO_GENERATE");
        poller.pollOnce();
        AiStubs.job(ai, jobId, AiStubs.succeeded(jobId, "SCENARIO_GENERATE", result));
        poller.pollOnce();
    }

    /** 생성까지 끝난 요청 id. SC-01(TC-01, TC-02, 통과), SC-02(TC-03, 가드 실패). */
    public String generatedRequest() throws Exception {
        String projectId = readyProject();
        String requestId = createRequest(projectId, "장바구니 담기 테스트");
        List<String> candidates = refine(requestId, "job-refine");
        select(requestId, candidates.get(0));
        generate("job-gen", AiStubs.generation(AiStubs.scenario("SC-01", true, "TC-01", "TC-02"),
                AiStubs.scenario("SC-02", false, "TC-03")));
        return requestId;
    }
}
