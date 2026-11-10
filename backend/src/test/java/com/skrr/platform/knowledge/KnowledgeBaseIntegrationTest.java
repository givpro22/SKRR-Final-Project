package com.skrr.platform.knowledge;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.matchingJsonPath;
import static com.github.tomakehurst.wiremock.client.WireMock.okJson;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathMatching;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.github.tomakehurst.wiremock.http.Fault;
import com.github.tomakehurst.wiremock.verification.LoggedRequest;
import com.jayway.jsonpath.JsonPath;
import com.skrr.platform.common.job.AsyncJobPoller;
import com.skrr.platform.support.Fixtures;
import com.skrr.platform.support.IntegrationTest;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

/** FR-01: 필수 문서 누락 거부, 지식 베이스 구축 작업과 Document·KnowledgeBase 상태 전이. */
class KnowledgeBaseIntegrationTest extends IntegrationTest {

    @Autowired
    AsyncJobPoller poller;

    private String buildPath(String projectId) {
        return "/internal/v1/knowledge-bases/" + projectId + "/builds";
    }

    private void stubBuildAccepted(String projectId, String jobId) {
        AI.stubFor(post(urlEqualTo(buildPath(projectId))).willReturn(aResponse().withStatus(202)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"jobId\":\"" + jobId + "\",\"type\":\"KB_BUILD\",\"status\":\"QUEUED\"}")));
    }

    private void stubJob(String jobId, String body) {
        AI.stubFor(get(urlEqualTo("/internal/v1/jobs/" + jobId)).willReturn(okJson(body)));
    }

    private String succeeded(String jobId, List<String> documentIds) {
        StringBuilder docs = new StringBuilder();
        for (String id : documentIds) {
            if (!docs.isEmpty()) {
                docs.append(',');
            }
            docs.append("{\"documentId\":\"").append(id).append("\",\"status\":\"INDEXED\",\"summary\":{\"requirementCount\":42,\"elementCount\":7}}");
        }
        return "{\"jobId\":\"" + jobId + "\",\"type\":\"KB_BUILD\",\"status\":\"SUCCEEDED\","
                + "\"progress\":{\"phase\":\"INDEX\",\"percent\":100},"
                + "\"result\":{\"kind\":\"KB_BUILD\",\"chunkCount\":1284,\"requirementCount\":42,\"apiCount\":18,"
                + "\"uiElementCount\":7,\"documents\":[" + docs + "]},\"error\":null}";
    }

    private ResultActions getKb(String projectId) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.get("/api/v1/projects/{id}/knowledge-base", projectId));
    }

    private ResultActions build(String projectId) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.post("/api/v1/projects/{id}/knowledge-base/build", projectId));
    }

    private List<String> activeIndexedDocumentIds(String projectId) {
        return jdbc.queryForList("select id::text from document where project_id = ?::uuid and is_active "
                + "and type <> 'TEST_DATA' order by type", String.class, projectId);
    }

    private String documentStatus(String projectId, String type) {
        return jdbc.queryForObject("select status from document where project_id = ?::uuid and type = ? and is_active",
                String.class, projectId, type);
    }

    @Test
    void missingRequiredDocumentsAreReported() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        getKb(projectId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("NOT_BUILT"))
                .andExpect(jsonPath("$.canBuild").value(false))
                .andExpect(jsonPath("$.missingDocumentTypes", containsInAnyOrder("REQUIREMENT", "API_SPEC", "CATALOG")))
                .andExpect(jsonPath("$.readiness", hasSize(4)))
                .andExpect(jsonPath("$.readiness[*].key", containsInAnyOrder("TARGET_REACHABLE",
                        "REQUIREMENT_ID_FORMAT", "READ_ONLY_QUERY_API", "CATALOG_TESTID_MAPPED")))
                .andExpect(jsonPath("$.lastSyncedAt").isEmpty());

        Fixtures.uploadOk(mvc, projectId, "REQUIREMENT", "requirements_v3.pdf");
        Fixtures.uploadOk(mvc, projectId, "API_SPEC", "openapi_shop.yaml");
        Fixtures.uploadOk(mvc, projectId, "TEST_DATA", "seed_accounts.json");

        build(projectId)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("MISSING_REQUIRED_DOCUMENTS"))
                .andExpect(jsonPath("$.missingDocumentTypes", hasSize(1)))
                .andExpect(jsonPath("$.missingDocumentTypes[0]").value("CATALOG"))
                .andExpect(jsonPath("$.detail", containsString("카탈로그")));
        getKb(projectId)
                .andExpect(jsonPath("$.status").value("NOT_BUILT"))
                .andExpect(jsonPath("$.missingDocumentTypes[0]").value("CATALOG"))
                .andExpect(jsonPath("$.readiness[?(@.key=='READ_ONLY_QUERY_API')].satisfied").value(true));
        assertThat(jdbc.queryForObject("select count(*) from async_job", Integer.class)).isZero();
        AI.verify(0, postRequestedFor(urlPathMatching(".*")));
    }

    @Test
    void buildFlowIndexesDocumentsAndMarksReady() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        Fixtures.uploadRequired(mvc, projectId);
        Fixtures.uploadOk(mvc, projectId, "TEST_DATA", "seed_accounts.json");
        getKb(projectId).andExpect(jsonPath("$.canBuild").value(true)).andExpect(jsonPath("$.missingDocumentTypes", hasSize(0)));

        build(projectId)
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("BUILDING"))
                .andExpect(jsonPath("$.canBuild").value(false));
        assertThat(documentStatus(projectId, "REQUIREMENT")).isEqualTo("INDEXING");
        assertThat(documentStatus(projectId, "TEST_DATA")).isEqualTo("REGISTERED");
        build(projectId).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("INVALID_STATE_TRANSITION"));

        stubBuildAccepted(projectId, "job-1");
        poller.pollOnce();
        List<LoggedRequest> sent = AI.findAll(postRequestedFor(urlEqualTo(buildPath(projectId))));
        assertThat(sent).hasSize(1);
        String body = sent.get(0).getBodyAsString();
        List<String> types = JsonPath.read(body, "$.documents[*].type");
        assertThat(types).containsExactly("REQUIREMENT", "API_SPEC", "CATALOG");
        List<Map<String, Object>> docs = JsonPath.read(body, "$.documents");
        assertThat(docs.get(0)).containsKeys("documentId", "version", "s3Key", "contentType", "checksumSha256");
        assertThat(jdbc.queryForObject("select remote_job_id from async_job", String.class)).isEqualTo("job-1");

        stubJob("job-1", "{\"jobId\":\"job-1\",\"type\":\"KB_BUILD\",\"status\":\"RUNNING\","
                + "\"progress\":{\"phase\":\"INDEX\",\"percent\":68}}");
        poller.pollOnce();
        mvc.perform(MockMvcRequestBuilders.get("/api/v1/projects/{id}/documents", projectId))
                .andExpect(jsonPath("$.items[?(@.type=='API_SPEC')].indexProgress").value(68))
                .andExpect(jsonPath("$.items[?(@.type=='API_SPEC')].status").value("INDEXING"));

        stubJob("job-1", succeeded("job-1", activeIndexedDocumentIds(projectId)));
        poller.pollOnce();
        getKb(projectId)
                .andExpect(jsonPath("$.status").value("READY"))
                .andExpect(jsonPath("$.chunkCount").value(1284))
                .andExpect(jsonPath("$.requirementCount").value(42))
                .andExpect(jsonPath("$.apiCount").value(18))
                .andExpect(jsonPath("$.uiElementCount").value(7))
                .andExpect(jsonPath("$.lastSyncedAt").isString())
                .andExpect(jsonPath("$.canBuild").value(false))
                .andExpect(jsonPath("$.readiness[?(@.key=='REQUIREMENT_ID_FORMAT')].satisfied").value(true))
                .andExpect(jsonPath("$.readiness[?(@.key=='CATALOG_TESTID_MAPPED')].satisfied").value(true));
        mvc.perform(MockMvcRequestBuilders.get("/api/v1/projects/{id}/documents", projectId))
                .andExpect(jsonPath("$.items[?(@.type=='REQUIREMENT')].status").value("INDEXED"))
                .andExpect(jsonPath("$.items[?(@.type=='REQUIREMENT')].indexProgress").value(100))
                .andExpect(jsonPath("$.items[?(@.type=='REQUIREMENT')].summary.requirementCount").value(42));
        assertThat(jdbc.queryForObject("select status from async_job", String.class)).isEqualTo("SUCCEEDED");
        mvc.perform(MockMvcRequestBuilders.get("/api/v1/projects/{id}/activities", projectId))
                .andExpect(jsonPath("$.items[0].message").value("지식 베이스 구축 완료 · 청크 1,284개"));

        // TEST_DATA 교체는 STALE 을 만들지 않는다 (ADR-020)
        Fixtures.uploadOk(mvc, projectId, "TEST_DATA", "seed_accounts_v2.json");
        getKb(projectId).andExpect(jsonPath("$.status").value("READY"));

        // 필수 문서가 바뀌면 READY → STALE, 재구축은 활성 필수 3종 모두 INDEXING (INDEXED → INDEXING)
        Fixtures.uploadOk(mvc, projectId, "API_SPEC", "openapi_shop_v2.yaml");
        getKb(projectId).andExpect(jsonPath("$.status").value("STALE")).andExpect(jsonPath("$.canBuild").value(true));
        build(projectId).andExpect(status().isAccepted());
        assertThat(documentStatus(projectId, "API_SPEC")).isEqualTo("INDEXING");
        assertThat(documentStatus(projectId, "REQUIREMENT")).isEqualTo("INDEXING");
        assertThat(documentStatus(projectId, "CATALOG")).isEqualTo("INDEXING");
        assertThat(documentStatus(projectId, "TEST_DATA")).isEqualTo("REGISTERED");
        mvc.perform(MockMvcRequestBuilders.get("/api/v1/projects/{id}/documents", projectId))
                .andExpect(jsonPath("$.items[?(@.type=='REQUIREMENT')].indexProgress").value(0));
    }

    @Test
    void lostJobIsResubmittedOnceThenFails() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        Fixtures.uploadRequired(mvc, projectId);
        build(projectId).andExpect(status().isAccepted());
        stubBuildAccepted(projectId, "job-lost");
        poller.pollOnce();

        AI.stubFor(get(urlEqualTo("/internal/v1/jobs/job-lost")).willReturn(aResponse().withStatus(404)));
        poller.pollOnce();
        assertThat(jdbc.queryForObject("select status || ':' || attempt from async_job", String.class))
                .isEqualTo("QUEUED:2");
        getKb(projectId).andExpect(jsonPath("$.status").value("BUILDING"));

        poller.pollOnce();
        AI.verify(2, postRequestedFor(urlEqualTo(buildPath(projectId))));
        poller.pollOnce();
        assertThat(jdbc.queryForObject("select status from async_job", String.class)).isEqualTo("FAILED");
        getKb(projectId)
                .andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.errorMessage", containsString("찾을 수 없습니다")))
                .andExpect(jsonPath("$.canBuild").value(true));
        assertThat(documentStatus(projectId, "CATALOG")).isEqualTo("FAILED");

        // FAILED → BUILDING 재시도에서 실패 문서는 다시 INDEXING
        build(projectId).andExpect(status().isAccepted());
        assertThat(documentStatus(projectId, "CATALOG")).isEqualTo("INDEXING");
    }

    @Test
    void aiOutageOnSubmitFailsBuildWithReason() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        Fixtures.uploadRequired(mvc, projectId);
        build(projectId).andExpect(status().isAccepted());
        AI.stubFor(post(urlEqualTo(buildPath(projectId))).willReturn(aResponse().withStatus(503)));

        poller.pollOnce();
        AI.verify(3, postRequestedFor(urlEqualTo(buildPath(projectId))));
        getKb(projectId)
                .andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.errorMessage", containsString("AI 서버")));
        assertThat(documentStatus(projectId, "REQUIREMENT")).isEqualTo("FAILED");
    }

    @Test
    void pollNetworkErrorsAreToleratedUntilLimit() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        Fixtures.uploadRequired(mvc, projectId);
        build(projectId).andExpect(status().isAccepted());
        stubBuildAccepted(projectId, "job-net");
        poller.pollOnce();
        AI.stubFor(get(urlEqualTo("/internal/v1/jobs/job-net"))
                .willReturn(aResponse().withFault(Fault.CONNECTION_RESET_BY_PEER)));
        poller.pollOnce();
        poller.pollOnce();
        getKb(projectId).andExpect(jsonPath("$.status").value("BUILDING"));
        poller.pollOnce();
        getKb(projectId).andExpect(jsonPath("$.status").value("FAILED"));
    }

    @Test
    void nonRetryableAiFailureIsNotRetried() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        Fixtures.uploadRequired(mvc, projectId);
        build(projectId).andExpect(status().isAccepted());
        stubBuildAccepted(projectId, "job-x");
        poller.pollOnce();
        stubJob("job-x", "{\"jobId\":\"job-x\",\"type\":\"KB_BUILD\",\"status\":\"FAILED\","
                + "\"error\":{\"code\":\"DOCUMENT_PARSE_FAILED\",\"message\":\"PDF를 읽을 수 없음\",\"retryable\":false}}");
        poller.pollOnce();
        AI.verify(1, postRequestedFor(urlEqualTo(buildPath(projectId))));
        getKb(projectId)
                .andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.errorMessage", containsString("DOCUMENT_PARSE_FAILED")));
    }

    @Test
    void retryableAiFailureIsResubmittedOnce() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        Fixtures.uploadRequired(mvc, projectId);
        build(projectId).andExpect(status().isAccepted());
        stubBuildAccepted(projectId, "job-r");
        poller.pollOnce();
        stubJob("job-r", "{\"jobId\":\"job-r\",\"type\":\"KB_BUILD\",\"status\":\"FAILED\","
                + "\"error\":{\"code\":\"LLM_TIMEOUT\",\"message\":\"timeout\",\"retryable\":true}}");
        poller.pollOnce();
        poller.pollOnce();
        AI.verify(2, postRequestedFor(urlEqualTo(buildPath(projectId))));
        poller.pollOnce();
        getKb(projectId).andExpect(jsonPath("$.status").value("FAILED"));
    }

    @Test
    void documentFailureInResultFailsKnowledgeBase() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        Fixtures.uploadRequired(mvc, projectId);
        build(projectId).andExpect(status().isAccepted());
        stubBuildAccepted(projectId, "job-d");
        poller.pollOnce();
        List<String> ids = activeIndexedDocumentIds(projectId);
        String body = succeeded("job-d", ids.subList(0, 2)).replace("\"documents\":[",
                "\"documents\":[{\"documentId\":\"" + ids.get(2) + "\",\"status\":\"FAILED\",\"error\":\"testId 열 없음\"},");
        stubJob("job-d", body);
        poller.pollOnce();
        getKb(projectId)
                .andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.errorMessage", containsString("testId 열 없음")));
        assertThat(jdbc.queryForObject("select error_message from document where id = ?::uuid", String.class,
                ids.get(2))).isEqualTo("testId 열 없음");
    }

    @Test
    void malformedResultFailsJobWithoutPartialUpdate() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        Fixtures.uploadRequired(mvc, projectId);
        build(projectId).andExpect(status().isAccepted());
        stubBuildAccepted(projectId, "job-m");
        poller.pollOnce();
        stubJob("job-m", "{\"jobId\":\"job-m\",\"type\":\"KB_BUILD\",\"status\":\"SUCCEEDED\",\"result\":{\"kind\":\"OTHER\"}}");
        poller.pollOnce();
        getKb(projectId)
                .andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.chunkCount").value(0))
                .andExpect(jsonPath("$.errorMessage", containsString("계약")));
    }

    @Test
    void requiredUploadAfterSubmitMakesResultStaleButTestDataDoesNot() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        Fixtures.uploadRequired(mvc, projectId);
        build(projectId).andExpect(status().isAccepted());
        stubBuildAccepted(projectId, "job-s");
        poller.pollOnce();
        List<String> sentIds = activeIndexedDocumentIds(projectId);
        Fixtures.uploadOk(mvc, projectId, "TEST_DATA", "seed_accounts.json");
        stubJob("job-s", succeeded("job-s", sentIds));
        poller.pollOnce();
        getKb(projectId).andExpect(jsonPath("$.status").value("READY"));

        build(projectId).andExpect(status().isConflict());
        Fixtures.uploadOk(mvc, projectId, "CATALOG", "catalog_v2.csv");
        build(projectId).andExpect(status().isAccepted());
        stubBuildAccepted(projectId, "job-s2");
        poller.pollOnce();
        List<String> sentIds2 = activeIndexedDocumentIds(projectId);
        Fixtures.uploadOk(mvc, projectId, "REQUIREMENT", "requirements_v4.pdf");
        getKb(projectId).andExpect(jsonPath("$.status").value("BUILDING"));
        stubJob("job-s2", succeeded("job-s2", sentIds2));
        poller.pollOnce();
        getKb(projectId).andExpect(jsonPath("$.status").value("STALE")).andExpect(jsonPath("$.chunkCount").value(1284));
        assertThat(documentStatus(projectId, "REQUIREMENT")).isEqualTo("UPLOADED");
    }

    @Test
    void newVersionUploadedBeforeSubmitIsIncludedInBuild() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        Fixtures.uploadRequired(mvc, projectId);
        build(projectId).andExpect(status().isAccepted());
        // 구축 요청 뒤, 스케줄러가 AI로 보내기 전에 같은 유형 새 버전 업로드 (QA Q-BE-1)
        String newSpec = Fixtures.uploadOk(mvc, projectId, "API_SPEC", "openapi_shop_v2.yaml");
        stubBuildAccepted(projectId, "job-race");
        poller.pollOnce();
        String body = AI.findAll(postRequestedFor(urlEqualTo(buildPath(projectId)))).get(0).getBodyAsString();
        List<String> sentIds = JsonPath.read(body, "$.documents[*].documentId");
        assertThat(sentIds).contains(newSpec).hasSize(3);
        assertThat(documentStatus(projectId, "API_SPEC")).isEqualTo("INDEXING");

        stubJob("job-race", succeeded("job-race", sentIds));
        poller.pollOnce();
        getKb(projectId).andExpect(jsonPath("$.status").value("READY"));
        assertThat(documentStatus(projectId, "API_SPEC")).isEqualTo("INDEXED");
        // 비활성(이전 버전) 문서의 상태는 바꾸지 않는다 (state-machines.md Document)
        assertThat(jdbc.queryForObject("select status from document where project_id = ?::uuid and type = "
                + "'API_SPEC' and not is_active", String.class, projectId)).isEqualTo("INDEXING");
    }

    @Test
    void failedJobKeepsPerDocumentErrors() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        Fixtures.uploadRequired(mvc, projectId);
        build(projectId).andExpect(status().isAccepted());
        stubBuildAccepted(projectId, "job-pf");
        poller.pollOnce();
        List<String> ids = activeIndexedDocumentIds(projectId);
        stubJob("job-pf", "{\"jobId\":\"job-pf\",\"type\":\"KB_BUILD\",\"status\":\"FAILED\","
                + "\"result\":{\"kind\":\"KB_BUILD\",\"chunkCount\":0,\"requirementCount\":0,\"apiCount\":0,"
                + "\"uiElementCount\":0,\"documents\":["
                + "{\"documentId\":\"" + ids.get(0) + "\",\"status\":\"FAILED\",\"error\":\"요구사항 ID를 찾지 못했어요\"},"
                + "{\"documentId\":\"" + ids.get(1) + "\",\"status\":\"SKIPPED\",\"error\":\"다른 문서의 오류로 지식 베이스를 만들지 않았어요\"}]},"
                + "\"error\":{\"code\":\"DOCUMENT_PARSE_FAILED\",\"message\":\"문서 파싱 실패\",\"retryable\":false}}");
        poller.pollOnce();
        getKb(projectId).andExpect(jsonPath("$.status").value("FAILED"));
        assertThat(jdbc.queryForObject("select status || ':' || error_message from document where id = ?::uuid",
                String.class, ids.get(0))).isEqualTo("FAILED:요구사항 ID를 찾지 못했어요");
        assertThat(jdbc.queryForObject("select status || ':' || error_message from document where id = ?::uuid",
                String.class, ids.get(1))).isEqualTo("SKIPPED:다른 문서의 오류로 지식 베이스를 만들지 않았어요");
        // 결과에 없는 처리 중 문서는 작업 사유로 FAILED
        assertThat(jdbc.queryForObject("select status || ':' || error_message from document where id = ?::uuid",
                String.class, ids.get(2))).startsWith("FAILED:").contains("DOCUMENT_PARSE_FAILED");
        mvc.perform(MockMvcRequestBuilders.get("/api/v1/projects/{id}/documents", projectId))
                .andExpect(jsonPath("$.items[?(@.status=='SKIPPED')]", hasSize(1)));

        // SKIPPED·FAILED 문서는 재구축으로 다시 INDEXING
        build(projectId).andExpect(status().isAccepted());
        assertThat(jdbc.queryForObject("select status from document where id = ?::uuid", String.class,
                ids.get(1))).isEqualTo("INDEXING");
    }

    @Test
    void deleteIsBlockedWhileBuildingAndMakesReadyStale() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        Fixtures.uploadRequired(mvc, projectId);
        String testData = Fixtures.uploadOk(mvc, projectId, "TEST_DATA", "seed_accounts.json");
        build(projectId).andExpect(status().isAccepted());
        mvc.perform(delete("/api/v1/documents/{id}", testData))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE_TRANSITION"));

        stubBuildAccepted(projectId, "job-del");
        poller.pollOnce();
        stubJob("job-del", succeeded("job-del", activeIndexedDocumentIds(projectId)));
        poller.pollOnce();
        getKb(projectId).andExpect(jsonPath("$.status").value("READY"));

        // TEST_DATA 삭제는 STALE 을 만들지 않고, 필수 문서 삭제는 만든다 (ADR-020)
        mvc.perform(delete("/api/v1/documents/{id}", testData)).andExpect(status().isNoContent());
        getKb(projectId).andExpect(jsonPath("$.status").value("READY"));
        String catalog = activeIndexedDocumentIds(projectId).get(1);
        mvc.perform(delete("/api/v1/documents/{id}", catalog)).andExpect(status().isNoContent());
        getKb(projectId).andExpect(jsonPath("$.status").value("STALE"))
                .andExpect(jsonPath("$.missingDocumentTypes[0]").value("CATALOG"));
    }

    @Test
    void unknownProjectIs404() throws Exception {
        String random = java.util.UUID.randomUUID().toString();
        getKb(random).andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
        build(random).andExpect(status().isNotFound());
    }

    @Test
    void openJobsResumeFromDatabase() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        Fixtures.uploadRequired(mvc, projectId);
        build(projectId).andExpect(status().isAccepted());
        // 재시작을 흉내: 이미 원격 작업 ID가 있는 RUNNING 작업이 DB에 남아 있다
        jdbc.update("update async_job set status = 'RUNNING', remote_job_id = 'job-resume'");
        stubJob("job-resume", succeeded("job-resume", activeIndexedDocumentIds(projectId)));
        poller.pollOnce();
        AI.verify(0, postRequestedFor(urlPathMatching(".*")));
        getKb(projectId).andExpect(jsonPath("$.status").value("READY"));
        AI.verify(0, postRequestedFor(urlPathMatching(".*")).withRequestBody(matchingJsonPath("$.documents")));
    }
}
