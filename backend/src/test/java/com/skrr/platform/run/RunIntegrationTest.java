package com.skrr.platform.run;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.equalTo;
import static com.github.tomakehurst.wiremock.client.WireMock.getRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathMatching;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.github.tomakehurst.wiremock.stubbing.Scenario;
import com.github.tomakehurst.wiremock.verification.LoggedRequest;
import com.jayway.jsonpath.JsonPath;
import com.skrr.platform.common.job.AsyncJobPoller;
import com.skrr.platform.support.Fixtures;
import com.skrr.platform.support.IntegrationTest;
import com.skrr.platform.support.M2Flow;
import com.skrr.platform.support.RunStubs;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/** FR-04·05: 실행 시작 검증, PREPARING(TestQuery·spec), 케이스 실행 순서, 교차 검증, 증거, SSE, 중단, 장애 ERROR. */
class RunIntegrationTest extends IntegrationTest {

    @Autowired
    AsyncJobPoller poller;

    String requestId;
    String projectId;
    String sc1;
    String sc2;

    @BeforeEach
    void setUp() throws Exception {
        M2Flow flow = new M2Flow(mvc, jdbc, AI, poller);
        requestId = flow.generatedRequest();
        projectId = jdbc.queryForObject("select project_id::text from test_request where id = ?::uuid", String.class,
                UUID.fromString(requestId));
        sc1 = jdbc.queryForObject("select id::text from scenario where code = 'SC-01'", String.class);
        sc2 = jdbc.queryForObject("select id::text from scenario where code = 'SC-02'", String.class);
        mvc.perform(post("/api/v1/scenarios/{id}/approve", sc1)).andExpect(status().isOk());
        String base = TARGET.baseUrl();
        mvc.perform(patch("/api/v1/projects/{id}", projectId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"targetUrl\":\"" + base + "\",\"testControlUrl\":\"" + base + "/api/test\","
                        + "\"queryApiBaseUrl\":\"" + base + "/api/test/query\"}")).andExpect(status().isOk());
        Fixtures.upload(mvc, projectId, "TEST_DATA", "seed_accounts.json",
                "{\"variables\":{\"memberEmail\":\"member@example.test\"},\"secrets\":{\"memberPassword\":\"pw-secret\"}}"
                        .getBytes(StandardCharsets.UTF_8)).andExpect(status().isCreated());
        AI.resetAll();
    }

    private ResultActions start(String body) throws Exception {
        return mvc.perform(post("/api/v1/test-requests/{id}/runs", requestId)
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private String startOk(String... scenarioIds) throws Exception {
        String json = start("{\"scenarioIds\":[\"" + String.join("\",\"", scenarioIds) + "\"]}")
                .andExpect(status().isAccepted())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(json, "$.id");
    }

    private String awaitEnd(String runId) {
        await().atMost(Duration.ofSeconds(30)).pollInterval(Duration.ofMillis(100)).until(() -> {
            String s = jdbc.queryForObject("select status from test_run where id = ?::uuid", String.class,
                    UUID.fromString(runId));
            return !List.of("PREPARING", "RUNNING", "CANCELLING").contains(s);
        });
        return jdbc.queryForObject("select status from test_run where id = ?::uuid", String.class,
                UUID.fromString(runId));
    }

    private ResultActions getRun(String runId) throws Exception {
        return mvc.perform(get("/api/v1/runs/{id}", runId));
    }

    @Test
    void startValidation() throws Exception {
        start("{\"scenarioIds\":[]}").andExpect(status().isBadRequest());
        start("{\"scenarioIds\":[\"" + sc1 + "\",\"" + sc1 + "\"]}").andExpect(status().isBadRequest());
        start("{\"scenarioIds\":[\"" + UUID.randomUUID() + "\"]}")
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        start("{\"scenarioIds\":[\"" + sc1 + "\",\"" + sc2 + "\"]}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SCENARIO_NOT_APPROVED"))
                .andExpect(jsonPath("$.detail", containsString("SC-02")));
        mvc.perform(post("/api/v1/test-requests/{id}/runs", UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"scenarioIds\":[\"" + sc1 + "\"]}")).andExpect(status().isNotFound());

        // 다른 프로젝트의 진행 중 실행이 있어도 409 (U3 전체 기준)
        String otherProject = Fixtures.createProject(mvc, "{\"name\":\"다른 프로젝트\"}");
        String otherRequest = UUID.randomUUID().toString();
        jdbc.update("insert into test_request (id, project_id, seq, raw_text, status) values (?::uuid, ?::uuid, 1, 'x',"
                + " 'GENERATED')", UUID.fromString(otherRequest), UUID.fromString(otherProject));
        jdbc.update("insert into test_run (project_id, test_request_id, seq, status, target_url) values (?::uuid, ?::uuid,"
                + " 1, 'RUNNING', 'http://x')", UUID.fromString(otherProject), UUID.fromString(otherRequest));
        start("{\"scenarioIds\":[\"" + sc1 + "\"]}")
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("RUN_ALREADY_ACTIVE"));
        jdbc.update("update test_run set status = 'ERROR'");

        jdbc.update("update project set target_url = null where id = ?::uuid", UUID.fromString(projectId));
        start("{\"scenarioIds\":[\"" + sc1 + "\"]}")
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("TARGET_URL_MISSING"));
        assertThat(jdbc.queryForObject("select count(*) from test_run where project_id = ?::uuid", Integer.class,
                UUID.fromString(projectId))).isZero();
    }

    @Test
    void happyPathRunsCaseOrderAndStoresEvidence() throws Exception {
        RunStubs.happyPath(AI, RUNNER, TARGET);
        String json = start("{\"scenarioIds\":[\"" + sc1 + "\"]}")
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.code").value("RUN-0001"))
                .andExpect(jsonPath("$.status").value("PREPARING"))
                .andExpect(jsonPath("$.documentVersions.TEST_DATA").value(1))
                .andExpect(jsonPath("$.startedBy.displayName").value("기본 사용자"))
                .andReturn().getResponse().getContentAsString();
        String runId = JsonPath.read(json, "$.id");
        assertThat(awaitEnd(runId)).isEqualTo("PASSED");

        String detail = getRun(runId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PASSED"))
                .andExpect(jsonPath("$.browser").value("Chromium 130.0.6723.31"))
                .andExpect(jsonPath("$.targetBuild").value("a3f9c21"))
                .andExpect(jsonPath("$.startedAt").isString())
                .andExpect(jsonPath("$.finishedAt").isString())
                .andExpect(jsonPath("$.progress.totalScenarios").value(1))
                .andExpect(jsonPath("$.progress.passed").value(1))
                .andExpect(jsonPath("$.progress.finishedScenarios").value(1))
                .andExpect(jsonPath("$.scenarioRuns[0].code").value("SC-01"))
                .andExpect(jsonPath("$.scenarioRuns[0].status").value("PASSED"))
                .andExpect(jsonPath("$.scenarioRuns[0].cases", hasSize(2)))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].code").value("TC-01"))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].status").value("PASSED"))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].attempts").value(1))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].steps", hasSize(7)))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].steps[0].kind").value("SETUP"))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].steps[2].kind").value("API"))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].steps[2].schemaCheck").value("PASSED"))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].steps[4].kind").value("DB"))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].steps[5].kind").value("ASSERT"))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].steps[6].kind").value("TEARDOWN"))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].steps[*].status",
                        org.hamcrest.Matchers.everyItem(org.hamcrest.Matchers.is("PASSED"))))
                .andExpect(jsonPath("$.currentPath").value("/products/1"))
                .andExpect(jsonPath("$.latestScreenshotArtifactId").isString())
                .andReturn().getResponse().getContentAsString();
        long lastSeq = ((Number) JsonPath.read(detail, "$.lastEventSeq")).longValue();
        assertThat(lastSeq).isPositive();
        String caseResultId = JsonPath.read(detail, "$.scenarioRuns[0].cases[0].id");

        // AI 요청: 이름만, 값 없음
        String aiBody = AI.findAll(postRequestedFor(urlEqualTo(RunStubs.TQ_PATH))).get(0).getBodyAsString();
        assertThat((List<String>) JsonPath.read(aiBody, "$.availableVariables"))
                .containsExactlyInAnyOrder("memberEmail", "memberPassword");
        assertThat(aiBody).doesNotContain("pw-secret").doesNotContain("member@example.test");
        assertThat((String) JsonPath.read(aiBody, "$.testCase.expectedValues[0].expected")).isEqualTo("3");
        assertThat((String) JsonPath.read(aiBody, "$.queryApiBaseUrl")).isEqualTo(TARGET.baseUrl() + "/api/test/query");
        // 실행기 요청: 값은 실행 때 채움, 비밀값은 secretVariables
        List<LoggedRequest> execs = RUNNER.findAll(postRequestedFor(urlEqualTo(RunStubs.EXEC_PATH)));
        assertThat(execs).hasSize(2);
        String execBody = execs.get(0).getBodyAsString();
        assertThat((String) JsonPath.read(execBody, "$.testQuery.variables.memberEmail")).isEqualTo("member@example.test");
        assertThat((String) JsonPath.read(execBody, "$.secretVariables.memberPassword")).isEqualTo("pw-secret");
        assertThat((String) JsonPath.read(execBody, "$.baseUrl")).isEqualTo(TARGET.baseUrl());
        assertThat((Integer) JsonPath.read(execBody, "$.timeoutMs")).isEqualTo(5000);
        assertThat((String) JsonPath.read(execs.get(0).getBodyAsString(), "$.executionId"))
                .isNotEqualTo(JsonPath.read(execs.get(1).getBodyAsString(), "$.executionId"));
        // 저장본에는 테스트 데이터 값이 없다 (A16)
        String stored = jdbc.queryForObject("select test_query::text from generated_spec limit 1", String.class);
        assertThat(stored).doesNotContain("member@example.test").doesNotContain("pw-secret");
        // 대상 사이트: 초기화(SETUP·TEARDOWN) 토큰, DB 조회는 GET + 변수 채움
        TARGET.verify(4, postRequestedFor(urlEqualTo("/api/test/reset"))
                .withHeader("X-Test-Control-Token", equalTo("test-token")));
        TARGET.verify(2, getRequestedFor(urlEqualTo("/api/test/query/cart?email=member@example.test"))
                .withHeader("X-Test-Control-Token", equalTo("test-token")));

        assertThat(jdbc.queryForObject("select verdict || ':' || ui_value || ':' || api_value || ':' || db_value || ':' "
                + "|| expected_value from verification where case_result_id = ?::uuid", String.class,
                UUID.fromString(caseResultId))).isEqualTo("MATCH:3:3:3:3");
        assertThat(jdbc.queryForList("select type from artifact where case_result_id = ?::uuid order by type",
                String.class, UUID.fromString(caseResultId))).containsExactly("HAR", "SCREENSHOT", "TRACE");
        String key = jdbc.queryForObject("select s3_key from artifact where type = 'TRACE' and case_result_id = ?::uuid",
                String.class, UUID.fromString(caseResultId));
        assertThat(key).isEqualTo("run-artifacts/" + runId + "/" + caseResultId + "/attempt-1/trace.zip");
        assertThat(STORAGE_DIR.resolve(key)).exists();

        mvc.perform(get("/api/v1/case-results/{id}/spec", caseResultId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.testCaseCode").value("TC-01"))
                .andExpect(jsonPath("$.fileName").value("tc-01.spec.ts"))
                .andExpect(jsonPath("$.rendererVersion").value("1.0.0"))
                .andExpect(jsonPath("$.compileStatus").value("PASSED"));
        String artifactId = JsonPath.read(detail, "$.latestScreenshotArtifactId");
        String link = mvc.perform(get("/api/v1/artifacts/{id}/download-link", artifactId))
                .andExpect(status().isOk()).andExpect(jsonPath("$.url", containsString("step-1.png")))
                .andReturn().getResponse().getContentAsString();
        URI url = URI.create(JsonPath.read(link, "$.url"));
        var png = rest.getForEntity(URI.create(rest.getRootUri() + url.getRawPath() + "?" + url.getRawQuery()),
                byte[].class);
        assertThat(png.getStatusCode().value()).isEqualTo(200);
        assertThat(png.getHeaders().getContentType()).hasToString("image/png");
        mvc.perform(get("/api/v1/runs/{id}/api-calls", runId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalCount").value(2))
                .andExpect(jsonPath("$.averageDurationMs").value(42))
                .andExpect(jsonPath("$.items[0].method").value("POST"))
                .andExpect(jsonPath("$.items[0].statusCode").value(201));
        String logs = mvc.perform(get("/api/v1/runs/{id}/logs?limit=200", runId))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        List<String> messages = JsonPath.read(logs, "$.items[*].message");
        assertThat(messages).anyMatch(m -> m.contains("데이터 초기화 완료"))
                .anyMatch(m -> m.equals("장바구니 수량: 화면 3 / API 3 / DB 3 / 기대 3 → MATCH"))
                .anyMatch(m -> m.equals("password=***"));
        assertThat(String.join("\n", messages)).doesNotContain("pw-secret");
        List<String> types = jdbc.queryForList("select type from run_event where run_id = ?::uuid order by seq",
                String.class, UUID.fromString(runId));
        assertThat(types.get(0)).isEqualTo("run.status");
        assertThat(types).contains("scenario.status", "case.status", "step.status", "api.call", "screenshot",
                "verification", "log");
        assertThat(jdbc.queryForObject("select payload->>'status' from run_event where run_id = ?::uuid and type = "
                + "'run.status' order by seq desc limit 1", String.class, UUID.fromString(runId))).isEqualTo("PASSED");
        // 시나리오 상태가 바뀔 때마다 진행 집계를 담은 run.status 를 보낸다 (A14)
        List<String> progress = jdbc.queryForList("select payload->>'status' || ':' || (payload->'progress'->>'running')"
                + " || ':' || (payload->'progress'->>'finishedScenarios') from run_event where run_id = ?::uuid and type ="
                + " 'run.status' order by seq", String.class, UUID.fromString(runId));
        assertThat(progress).containsExactly("PREPARING:0:0", "RUNNING:0:0", "RUNNING:1:0", "RUNNING:0:1", "PASSED:0:1");
        assertThat(jdbc.queryForList("select payload->>'status' || ':' || coalesce(payload->>'durationMs', 'none') from"
                + " run_event where run_id = ?::uuid and type = 'scenario.status' order by seq", String.class,
                UUID.fromString(runId))).hasSize(2).first().isEqualTo("RUNNING:none");
        assertThat(jdbc.queryForObject("select payload->>'durationMs' from run_event where run_id = ?::uuid and type ="
                + " 'scenario.status' and payload->>'status' = 'PASSED'", String.class, UUID.fromString(runId)))
                .matches("\\d+");
        mvc.perform(get("/api/v1/projects/{id}/runs", projectId))
                .andExpect(jsonPath("$.items[0].code").value("RUN-0001"));

        // 두 번째 실행은 같은 케이스 version 의 TestQuery 를 재사용한다 (AI 호출 없음).
        // 실행기 렌더러가 1.1.0 으로 바뀌었으면 다시 렌더링한 spec 을 새로 저장한다 (generated_spec = 실제 실행 코드)
        AI.resetAll();
        RUNNER.stubFor(post(urlEqualTo(RunStubs.RENDER_PATH)).willReturn(com.github.tomakehurst.wiremock.client.WireMock
                .okJson("{\"specSource\":\"// renderer 1.1.0\",\"fileName\":\"tc-01.spec.ts\",\"rendererVersion\":"
                        + "\"1.1.0\",\"compileStatus\":\"PASSED\"}")));
        String second = startOk(sc1);
        assertThat(awaitEnd(second)).isEqualTo("PASSED");
        AI.verify(0, postRequestedFor(urlEqualTo(RunStubs.TQ_PATH)));
        String secondCase = JsonPath.read(getRun(second).andReturn().getResponse().getContentAsString(),
                "$.scenarioRuns[0].cases[0].id");
        mvc.perform(get("/api/v1/case-results/{id}/spec", secondCase))
                .andExpect(jsonPath("$.rendererVersion").value("1.1.0"))
                .andExpect(jsonPath("$.source").value("// renderer 1.1.0"));
        assertThat(jdbc.queryForList("select renderer_version from generated_spec order by renderer_version",
                String.class)).containsExactly("1.0.0", "1.0.0", "1.1.0", "1.1.0");
        // 렌더러가 그대로면 새 행을 만들지 않는다
        String third = startOk(sc1);
        assertThat(awaitEnd(third)).isEqualTo("PASSED");
        assertThat(jdbc.queryForObject("select count(*) from generated_spec", Integer.class)).isEqualTo(4);
    }

    @Test
    void sseReplaysFromAfterSeqAndLastEventIdThenCloses() throws Exception {
        RunStubs.happyPath(AI, RUNNER, TARGET);
        String runId = startOk(sc1);
        // 실행 중에 바로 붙어 끝까지 받는다
        List<String[]> live = readSse(runId, "afterSeq=0", null);
        assertThat(awaitEnd(runId)).isEqualTo("PASSED");
        List<Long> ids = live.stream().filter(e -> e[0] != null).map(e -> Long.parseLong(e[0])).toList();
        assertThat(ids).isSorted().doesNotHaveDuplicates();
        List<Long> stored = jdbc.queryForList("select seq from run_event where run_id = ?::uuid order by seq",
                Long.class, UUID.fromString(runId));
        assertThat(ids).isEqualTo(stored);
        String[] last = live.get(live.size() - 1);
        assertThat(last[1]).isEqualTo("run.status");
        assertThat(last[2]).contains("\"status\":\"PASSED\"").contains("\"runId\":\"" + runId + "\"").contains("occurredAt");

        // 재연결: Last-Event-ID 가 afterSeq 보다 우선, 그 뒤 이벤트만 받고 닫힌다
        long middle = stored.get(stored.size() / 2);
        List<String[]> resumed = readSse(runId, "afterSeq=0", String.valueOf(middle));
        List<Long> resumedIds = resumed.stream().filter(e -> e[0] != null).map(e -> Long.parseLong(e[0])).toList();
        assertThat(resumedIds).isEqualTo(stored.stream().filter(s -> s > middle).toList());
        // 끝난 실행에 마지막 seq 로 붙으면 바로 닫힌다
        assertThat(readSse(runId, "afterSeq=" + stored.get(stored.size() - 1), null)).isEmpty();
        mvc.perform(get("/api/v1/runs/{id}/events", UUID.randomUUID())).andExpect(status().isNotFound());
    }

    /** SSE 를 끝까지 읽어 [id, event, data] 목록으로 돌려준다 (heartbeat 제외). */
    private List<String[]> readSse(String runId, String query, String lastEventId) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(rest.getRootUri() + "/api/v1/runs/" + runId
                + "/events?" + query)).timeout(Duration.ofSeconds(30)).header("Accept", "text/event-stream");
        if (lastEventId != null) {
            builder.header("Last-Event-ID", lastEventId);
        }
        HttpResponse<java.io.InputStream> response = HttpClient.newHttpClient().send(builder.build(),
                HttpResponse.BodyHandlers.ofInputStream());
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("X-Accel-Buffering")).contains("no");
        List<String[]> out = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(response.body(), StandardCharsets.UTF_8))) {
            String line;
            String id = null;
            String event = null;
            StringBuilder data = new StringBuilder();
            while ((line = reader.readLine()) != null) {
                if (line.isEmpty()) {
                    if (event != null && !"heartbeat".equals(event)) {
                        out.add(new String[] {id, event, data.toString()});
                    }
                    id = null;
                    event = null;
                    data.setLength(0);
                } else if (line.startsWith("id:")) {
                    id = line.substring(3).trim();
                } else if (line.startsWith("event:")) {
                    event = line.substring(6).trim();
                } else if (line.startsWith("data:")) {
                    data.append(line.substring(5).trim());
                }
            }
        }
        return out;
    }

    @Test
    void dataMismatchIsReproducedThreeTimesAndRunFails() throws Exception {
        RunStubs.happyPath(AI, RUNNER, TARGET);
        RunStubs.target(TARGET, 2);
        String runId = startOk(sc1);
        assertThat(awaitEnd(runId)).isEqualTo("FAILED");
        String detail = getRun(runId)
                .andExpect(jsonPath("$.scenarioRuns[0].status").value("FAILED"))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].status").value("FAILED"))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].attempts").value(3))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].failedAttempts").value(3))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].steps[0].attempt").value(3))
                .andExpect(jsonPath("$.progress.failed").value(1))
                .andReturn().getResponse().getContentAsString();
        String caseId = JsonPath.read(detail, "$.scenarioRuns[0].cases[0].id");
        assertThat(jdbc.queryForObject("select failure_type from case_result where id = ?::uuid", String.class,
                UUID.fromString(caseId))).isEqualTo("DATA_MISMATCH");
        assertThat(jdbc.queryForObject("select verdict || ':' || db_value from verification where case_result_id = "
                + "?::uuid", String.class, UUID.fromString(caseId))).isEqualTo("MISMATCH:2");
        // 재현 시도마다 새 executionId, 초기화부터 다시 (3회 × SETUP·TEARDOWN = 6) + 두 번째 케이스도 같은 데이터로 실패
        assertThat(RUNNER.findAll(postRequestedFor(urlEqualTo(RunStubs.EXEC_PATH))).stream()
                .map(r -> (String) JsonPath.read(r.getBodyAsString(), "$.executionId")).distinct().count()).isEqualTo(6);
    }

    @Test
    void runnerFailureTypeIsKeptAndEnvironmentErrorsAreSeparated() throws Exception {
        RunStubs.happyPath(AI, RUNNER, TARGET);
        RunStubs.execution(RUNNER, "FAILED", "3", "3", "ELEMENT_NOT_FOUND");
        String runId = startOk(sc1);
        assertThat(awaitEnd(runId)).isEqualTo("FAILED");
        assertThat(jdbc.queryForList("select failure_type from case_result", String.class))
                .containsOnly("ELEMENT_NOT_FOUND");

        RunStubs.execution(RUNNER, "ERROR", "3", "3", null);
        String second = startOk(sc1);
        assertThat(awaitEnd(second)).isEqualTo("ERROR");
        getRun(second)
                .andExpect(jsonPath("$.scenarioRuns[0].status").value("ERROR"))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].status").value("ERROR"))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].attempts").value(1));
    }

    @Test
    void testQueryGenerationFailureMarksOnlyThatCaseError() throws Exception {
        RunStubs.happyPath(AI, RUNNER, TARGET);
        RunStubs.aiTestQuery(AI, RunStubs.tqResult("TC-01", false));
        String runId = startOk(sc1);
        assertThat(awaitEnd(runId)).isEqualTo("ERROR");
        // AI 가드가 이미 3회 재생성한 결과라 다시 요청하지 않는다 (케이스당 1회)
        AI.verify(2, postRequestedFor(urlEqualTo(RunStubs.TQ_PATH)));
        String detail = getRun(runId)
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].status").value("ERROR"))
                .andReturn().getResponse().getContentAsString();
        String caseId = JsonPath.read(detail, "$.scenarioRuns[0].cases[0].id");
        assertThat(jdbc.queryForObject("select failure_type || ':' || failure_message from case_result where id = ?::uuid",
                String.class, UUID.fromString(caseId))).startsWith("TEST_CODE_ERROR:").contains("가드 실패");
        mvc.perform(get("/api/v1/case-results/{id}/spec", caseId)).andExpect(status().isNotFound());
        RUNNER.verify(0, postRequestedFor(urlEqualTo(RunStubs.EXEC_PATH)));
    }

    @Test
    void compileFailureIsRetriedWithPreviousError() throws Exception {
        RunStubs.happyPath(AI, RUNNER, TARGET);
        RUNNER.stubFor(post(urlEqualTo(RunStubs.RENDER_PATH)).inScenario("compile").whenScenarioStateIs(Scenario.STARTED)
                .willReturn(com.github.tomakehurst.wiremock.client.WireMock.okJson("{\"specSource\":\"x\",\"fileName\":"
                        + "\"tc-01.spec.ts\",\"rendererVersion\":\"1.0.0\",\"compileStatus\":\"FAILED\","
                        + "\"compileErrors\":[\"TS2304: Cannot find name 'foo'\"]}"))
                .willSetStateTo("fixed"));
        RUNNER.stubFor(post(urlEqualTo(RunStubs.RENDER_PATH)).inScenario("compile").whenScenarioStateIs("fixed")
                .willReturn(com.github.tomakehurst.wiremock.client.WireMock.okJson("{\"specSource\":\"ok\",\"fileName\":"
                        + "\"tc-01.spec.ts\",\"rendererVersion\":\"1.0.0\",\"compileStatus\":\"PASSED\"}")));
        String runId = startOk(sc1);
        assertThat(awaitEnd(runId)).isEqualTo("PASSED");
        List<LoggedRequest> tq = AI.findAll(postRequestedFor(urlEqualTo(RunStubs.TQ_PATH)));
        assertThat(tq).hasSize(3);
        assertThat(tq.get(1).getBodyAsString()).contains("previousError").contains("TS2304");
    }

    @Test
    void savedTestQueryRenderFailureCountsAsFirstAttempt() throws Exception {
        RunStubs.happyPath(AI, RUNNER, TARGET);
        assertThat(awaitEnd(startOk(sc1))).isEqualTo("PASSED");
        AI.resetAll();
        RunStubs.aiTestQuery(AI, RunStubs.tqResult("TC-01", true));
        // 재사용하려던 TestQuery 가 새 렌더러에서 문법 검사에 실패 → AI 로 새로 생성(2회째부터), 사유를 previousError 로
        RUNNER.stubFor(post(urlEqualTo(RunStubs.RENDER_PATH)).inScenario("rerender")
                .whenScenarioStateIs(Scenario.STARTED)
                .willReturn(com.github.tomakehurst.wiremock.client.WireMock.okJson("{\"specSource\":\"x\",\"fileName\":"
                        + "\"tc-01.spec.ts\",\"rendererVersion\":\"1.2.0\",\"compileStatus\":\"FAILED\","
                        + "\"compileErrors\":[\"TS1005: ';' expected\"]}"))
                .willSetStateTo("ok"));
        RUNNER.stubFor(post(urlEqualTo(RunStubs.RENDER_PATH)).inScenario("rerender").whenScenarioStateIs("ok")
                .willReturn(com.github.tomakehurst.wiremock.client.WireMock.okJson("{\"specSource\":\"ok\",\"fileName\":"
                        + "\"tc-01.spec.ts\",\"rendererVersion\":\"1.2.0\",\"compileStatus\":\"PASSED\"}")));
        String runId = startOk(sc1);
        assertThat(awaitEnd(runId)).isEqualTo("PASSED");
        List<LoggedRequest> tq = AI.findAll(postRequestedFor(urlEqualTo(RunStubs.TQ_PATH)));
        assertThat(tq).hasSize(1);
        assertThat(tq.get(0).getBodyAsString()).contains("TS1005");
        String logs = mvc.perform(get("/api/v1/runs/{id}/logs?limit=200", runId)).andReturn().getResponse()
                .getContentAsString(StandardCharsets.UTF_8);
        assertThat(logs).contains("TC-01 TestQuery 생성 (2/3)");
    }

    @Test
    void nonRetryableAiFailureEndsCaseWithoutRetry() throws Exception {
        RunStubs.happyPath(AI, RUNNER, TARGET);
        AI.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlEqualTo("/internal/v1/jobs/tq-1"))
                .willReturn(com.github.tomakehurst.wiremock.client.WireMock.okJson("{\"jobId\":\"tq-1\","
                        + "\"type\":\"TEST_QUERY_GENERATE\",\"status\":\"FAILED\",\"result\":null,\"error\":"
                        + "{\"code\":\"INVALID_LLM_OUTPUT\",\"message\":\"형식 오류\",\"retryable\":false}}")));
        String runId = startOk(sc1);
        assertThat(awaitEnd(runId)).isEqualTo("ERROR");
        AI.verify(2, postRequestedFor(urlEqualTo(RunStubs.TQ_PATH)));
        assertThat(jdbc.queryForList("select failure_message from case_result", String.class))
                .allMatch(m -> m.contains("INVALID_LLM_OUTPUT"));
    }

    @Test
    void missingQueryApiSkipsDbAndExcludesItFromCrossCheck() throws Exception {
        RunStubs.happyPath(AI, RUNNER, TARGET);
        jdbc.update("update project set query_api_base_url = null where id = ?::uuid", UUID.fromString(projectId));
        String runId = startOk(sc1);
        assertThat(awaitEnd(runId)).isEqualTo("PASSED");
        String detail = getRun(runId)
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].steps[4].kind").value("DB"))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].steps[4].status").value("SKIPPED"))
                .andReturn().getResponse().getContentAsString();
        String caseId = JsonPath.read(detail, "$.scenarioRuns[0].cases[0].id");
        assertThat(jdbc.queryForObject("select verdict || ':' || coalesce(db_value, 'null') from verification where "
                + "case_result_id = ?::uuid", String.class, UUID.fromString(caseId))).isEqualTo("MATCH:null");
        TARGET.verify(0, getRequestedFor(urlPathMatching("/api/test/query/.*")));
        // 조회 API가 없으면 queryApiBaseUrl 을 보내지 않는다
        assertThat(AI.findAll(postRequestedFor(urlEqualTo(RunStubs.TQ_PATH))).get(0).getBodyAsString())
                .doesNotContain("queryApiBaseUrl");
    }

    @Test
    void dbCheckOutsideQueryApiIsNotExecuted() throws Exception {
        RunStubs.happyPath(AI, RUNNER, TARGET);
        RunStubs.aiTestQuery(AI, RunStubs.tqResult("TC-01", true).replace("/api/test/query/cart?", "/api/test/reset?"));
        String runId = startOk(sc1);
        assertThat(awaitEnd(runId)).isEqualTo("ERROR");
        assertThat(jdbc.queryForList("select status || ':' || failure_type || ':' || failure_message from case_result",
                String.class)).allMatch(m -> m.startsWith("ERROR:TEST_CODE_ERROR:") && m.contains("/api/test/reset"));
        RUNNER.verify(0, postRequestedFor(urlEqualTo(RunStubs.EXEC_PATH)));
        TARGET.verify(0, getRequestedFor(urlPathMatching("/api/test/reset.*")));
    }

    @Test
    void runnerOutageEndsRunInErrorAndSkipsRest() throws Exception {
        RunStubs.happyPath(AI, RUNNER, TARGET);
        RUNNER.stubFor(post(urlEqualTo(RunStubs.EXEC_PATH)).willReturn(aResponse().withStatus(503)));
        String runId = startOk(sc1);
        assertThat(awaitEnd(runId)).isEqualTo("ERROR");
        getRun(runId)
                .andExpect(jsonPath("$.errorMessage", containsString("실행기")))
                .andExpect(jsonPath("$.scenarioRuns[0].status").value("ERROR"))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].status").value("ERROR"))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[1].status").value("SKIPPED"));
        // 정리 단계는 실패 뒤에도 수행
        TARGET.verify(2, postRequestedFor(urlEqualTo("/api/test/reset")));
    }

    @Test
    void unreachableTargetEndsRunInError() throws Exception {
        RunStubs.happyPath(AI, RUNNER, TARGET);
        mvc.perform(patch("/api/v1/projects/{id}", projectId).contentType(MediaType.APPLICATION_JSON)
                .content("{\"testControlUrl\":\"http://127.0.0.1:1/api/test\"}")).andExpect(status().isOk());
        String runId = startOk(sc1);
        assertThat(awaitEnd(runId)).isEqualTo("ERROR");
        getRun(runId)
                .andExpect(jsonPath("$.errorMessage").value("대상 사이트에 연결할 수 없습니다 (연결 거부)"));
        RUNNER.verify(0, postRequestedFor(urlEqualTo(RunStubs.EXEC_PATH)));
    }

    @Test
    void runnerBusyIsRetriedNotAnError() throws Exception {
        RunStubs.happyPath(AI, RUNNER, TARGET);
        RUNNER.stubFor(post(urlEqualTo(RunStubs.EXEC_PATH)).inScenario("busy").whenScenarioStateIs(Scenario.STARTED)
                .willReturn(aResponse().withStatus(409).withHeader("Content-Type", "application/problem+json")
                        .withBody("{\"title\":\"busy\",\"status\":409,\"code\":\"RUNNER_BUSY\"}"))
                .willSetStateTo("free"));
        RUNNER.stubFor(post(urlEqualTo(RunStubs.EXEC_PATH)).inScenario("busy").whenScenarioStateIs("free")
                .willReturn(aResponse().withStatus(202).withHeader("Content-Type", "application/json")
                        .withBody("{\"executionId\":\"00000000-0000-0000-0000-00000000e001\",\"status\":\"QUEUED\"}")));
        String runId = startOk(sc1);
        assertThat(awaitEnd(runId)).isEqualTo("PASSED");
    }

    @Test
    void duplicateExecutionMeansAlreadyStarted() throws Exception {
        RunStubs.happyPath(AI, RUNNER, TARGET);
        RUNNER.stubFor(post(urlEqualTo(RunStubs.EXEC_PATH)).willReturn(aResponse().withStatus(409)
                .withHeader("Content-Type", "application/problem+json")
                .withBody("{\"title\":\"dup\",\"status\":409,\"code\":\"DUPLICATE_EXECUTION\"}")));
        String runId = startOk(sc1);
        assertThat(awaitEnd(runId)).isEqualTo("PASSED");
        RUNNER.verify(2, postRequestedFor(urlEqualTo(RunStubs.EXEC_PATH)));
    }

    @Test
    void cancelStopsRunAndRunnerExecution() throws Exception {
        RunStubs.happyPath(AI, RUNNER, TARGET);
        // 실행기가 끝나지 않는 실행: 상태 RUNNING, 이벤트 스트림은 늦게 닫힘
        RUNNER.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlPathMatching(RunStubs.EXEC_PATH + "/[^/]+"))
                .willReturn(com.github.tomakehurst.wiremock.client.WireMock.okJson(
                        "{\"executionId\":\"00000000-0000-0000-0000-00000000e001\",\"status\":\"RUNNING\"}")));
        RUNNER.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlPathMatching(RunStubs.EXEC_PATH
                        + "/[^/]+/events")).willReturn(aResponse().withStatus(200).withFixedDelay(1500)
                .withHeader("Content-Type", "text/event-stream").withBody("event: status\ndata: {\"status\":\"RUNNING\"}\n\n")));
        String runId = startOk(sc1);
        await().atMost(Duration.ofSeconds(10)).until(() -> !RUNNER.findAll(postRequestedFor(
                urlEqualTo(RunStubs.EXEC_PATH))).isEmpty());
        mvc.perform(post("/api/v1/runs/{id}/cancel", runId))
                .andExpect(status().isAccepted()).andExpect(jsonPath("$.status").value("CANCELLING"));
        mvc.perform(post("/api/v1/runs/{id}/cancel", runId)).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE_TRANSITION"));
        // 실행기 실행이 CANCELLED 로 끝난다
        RunStubs.execution(RUNNER, "CANCELLED", "3", "3", null);
        assertThat(awaitEnd(runId)).isEqualTo("CANCELLED");
        RUNNER.verify(com.github.tomakehurst.wiremock.client.WireMock.moreThanOrExactly(1),
                postRequestedFor(urlPathMatching(RunStubs.EXEC_PATH + "/[^/]+/cancel")));
        getRun(runId)
                .andExpect(jsonPath("$.scenarioRuns[0].status").value("CANCELLED"))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[0].status").value("CANCELLED"))
                .andExpect(jsonPath("$.scenarioRuns[0].cases[1].status").value("CANCELLED"));
        mvc.perform(post("/api/v1/runs/{id}/cancel", runId)).andExpect(status().isConflict());
        mvc.perform(post("/api/v1/runs/{id}/cancel", UUID.randomUUID())).andExpect(status().isNotFound());
    }

    @Test
    void runnerErrorAfterCancelCountsAsCancelled() throws Exception {
        RunStubs.happyPath(AI, RUNNER, TARGET);
        RUNNER.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlPathMatching(RunStubs.EXEC_PATH + "/[^/]+"))
                .willReturn(com.github.tomakehurst.wiremock.client.WireMock.okJson(
                        "{\"executionId\":\"00000000-0000-0000-0000-00000000e001\",\"status\":\"RUNNING\"}")));
        RUNNER.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlPathMatching(RunStubs.EXEC_PATH
                        + "/[^/]+/events")).willReturn(aResponse().withStatus(200).withFixedDelay(1500)
                .withHeader("Content-Type", "text/event-stream").withBody("event: status\ndata: {\"status\":\"RUNNING\"}\n\n")));
        String runId = startOk(sc1);
        await().atMost(Duration.ofSeconds(10)).until(() -> !RUNNER.findAll(postRequestedFor(
                urlEqualTo(RunStubs.EXEC_PATH))).isEmpty());
        mvc.perform(post("/api/v1/runs/{id}/cancel", runId)).andExpect(status().isAccepted());
        // 실행기가 중단 때문에 ERROR 로 끝냄 (브라우저 종료)
        RunStubs.execution(RUNNER, "ERROR", "3", "3", "ENVIRONMENT_ERROR");
        assertThat(awaitEnd(runId)).isEqualTo("CANCELLED");
        getRun(runId).andExpect(jsonPath("$.scenarioRuns[0].cases[0].status").value("CANCELLED"));
    }

    @Test
    void silentRunnerIsCancelledAtCaseDeadline() throws Exception {
        RunStubs.happyPath(AI, RUNNER, TARGET);
        // 실행기가 멈춤: 상태는 계속 RUNNING, 이벤트 스트림은 연결만 열고 아무것도 보내지 않음 (Q-M3-11)
        RUNNER.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlPathMatching(RunStubs.EXEC_PATH + "/[^/]+"))
                .willReturn(com.github.tomakehurst.wiremock.client.WireMock.okJson(
                        "{\"executionId\":\"00000000-0000-0000-0000-00000000e001\",\"status\":\"RUNNING\"}")));
        RUNNER.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlPathMatching(RunStubs.EXEC_PATH
                        + "/[^/]+/events")).willReturn(aResponse().withStatus(200).withFixedDelay(20000)
                .withHeader("Content-Type", "text/event-stream").withBody("")));
        String runId = startOk(sc1);
        await().atMost(Duration.ofSeconds(10)).until(() -> !RUNNER.findAll(postRequestedFor(
                urlEqualTo(RunStubs.EXEC_PATH))).isEmpty());
        long started = RUNNER.findAll(postRequestedFor(urlEqualTo(RunStubs.EXEC_PATH))).get(0).getLoggedDate().getTime();
        // 시도 시작 + case-timeout(5s) + grace(1s) 에 실행기에 중단을 보내고 TIMEOUT 으로 끝낸다
        await().atMost(Duration.ofSeconds(15)).until(() -> !RUNNER.findAll(postRequestedFor(
                urlPathMatching(RunStubs.EXEC_PATH + "/[^/]+/cancel"))).isEmpty());
        long cancelled = RUNNER.findAll(postRequestedFor(urlPathMatching(RunStubs.EXEC_PATH + "/[^/]+/cancel")))
                .get(0).getLoggedDate().getTime();
        assertThat(cancelled - started).isBetween(5500L, 8500L);
        await().atMost(Duration.ofSeconds(5)).until(() -> jdbc.queryForObject(
                "select count(*) from run_event where run_id = ?::uuid and type = 'log' "
                        + "and payload->>'message' like '%시간 제한(5초)을 넘겼습니다%'", Integer.class,
                UUID.fromString(runId)) > 0);
        mvc.perform(post("/api/v1/runs/{id}/cancel", runId)).andExpect(status().isAccepted());
        RunStubs.execution(RUNNER, "CANCELLED", "3", "3", null);
        assertThat(awaitEnd(runId)).isEqualTo("CANCELLED");
    }

    @Test
    void consoleErrorsAlreadyStreamedAreNotLoggedTwice() throws Exception {
        RunStubs.happyPath(AI, RUNNER, TARGET);
        String streamed = "Failed to load resource: the server responded with a status of 400 (Bad Request)";
        String sse = RunStubs.sse("PASSED").replace("event: status\ndata: {\"type\":\"status\",\"occurredAt\":\"2026-11-10T01:00:00Z\",\"data\":{\"status\":\"PASSED\"}}",
                "event: log\ndata: {\"type\":\"log\",\"occurredAt\":\"2026-11-10T01:00:00Z\",\"data\":{\"kind\":\"UI\","
                        + "\"message\":\"콘솔 오류: " + streamed + "\"}}\n\n"
                        + "event: status\ndata: {\"type\":\"status\",\"occurredAt\":\"2026-11-10T01:00:00Z\",\"data\":{\"status\":\"PASSED\"}}");
        RUNNER.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlPathMatching(RunStubs.EXEC_PATH
                        + "/[^/]+/events")).willReturn(aResponse().withStatus(200)
                .withHeader("Content-Type", "text/event-stream").withBody(sse)));
        RUNNER.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(urlPathMatching(RunStubs.EXEC_PATH + "/[^/]+"))
                .willReturn(com.github.tomakehurst.wiremock.client.WireMock.okJson(RunStubs.execution("PASSED", "3", "3", null)
                        .replace("\"consoleErrors\":[]", "\"consoleErrors\":[\"" + streamed + "\",\"Uncaught TypeError: x\"]"))));
        String runId = startOk(sc1);
        assertThat(awaitEnd(runId)).isEqualTo("PASSED");
        List<String> messages = jdbc.queryForList("select payload->>'message' from run_event where run_id = ?::uuid "
                + "and type = 'log' and payload->>'message' like '%콘솔 오류%' order by seq", String.class,
                UUID.fromString(runId));
        // 케이스 2개 × (스트림 1줄 + 스트림에 없던 콘솔 오류 보충 1줄)
        assertThat(messages).hasSize(4);
        assertThat(messages.stream().filter(m -> m.contains("400 (Bad Request)"))).hasSize(2)
                .allMatch(m -> m.startsWith("콘솔 오류: "));
        assertThat(messages.stream().filter(m -> m.contains("Uncaught TypeError"))).hasSize(2)
                .allMatch(m -> m.equals("브라우저 콘솔 오류: Uncaught TypeError: x"));
    }

    @Test
    void unapprovedAfterEditCannotRun() throws Exception {
        mvc.perform(patch("/api/v1/scenarios/{id}", sc1).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"승인 뒤 수정\"}")).andExpect(status().isOk());
        start("{\"scenarioIds\":[\"" + sc1 + "\"]}").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SCENARIO_NOT_APPROVED"));
    }
}
