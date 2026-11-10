package com.skrr.platform.project;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.equalToJson;
import static com.github.tomakehurst.wiremock.client.WireMock.okJson;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.github.tomakehurst.wiremock.http.Fault;
import com.skrr.platform.support.Fixtures;
import com.skrr.platform.support.IntegrationTest;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

class ProjectApiIntegrationTest extends IntegrationTest {

    private static final String CHECK_PATH = "/internal/v1/connectivity-checks";

    @Test
    void createListGetProjectAndKnowledgeBaseRow() throws Exception {
        String id = Fixtures.createProject(mvc);

        mvc.perform(get("/api/v1/projects/{id}", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("목업 쇼핑몰 v1.2"))
                .andExpect(jsonPath("$.targetUrl").value("https://shop-mock.skrr.dev"))
                .andExpect(jsonPath("$.targetUrlStatus").value("UNVERIFIED"))
                .andExpect(jsonPath("$.targetCheckedAt").isEmpty())
                .andExpect(jsonPath("$.createdAt").isString())
                .andExpect(jsonPath("$.updatedAt").isString());
        mvc.perform(get("/api/v1/projects"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].id").value(id));
        assertThat(jdbc.queryForObject("select status from knowledge_base where project_id = ?::uuid",
                String.class, id)).isEqualTo("NOT_BUILT");
        assertThat(jdbc.queryForObject("select created_by::text from project where id = ?::uuid",
                String.class, id)).isEqualTo("00000000-0000-0000-0000-000000000001");
        mvc.perform(get("/api/v1/projects/{id}/activities", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].message").value("프로젝트 생성: 목업 쇼핑몰 v1.2"))
                .andExpect(jsonPath("$.items[0].id").isNumber());
    }

    @Test
    void createValidationReturnsFieldErrors() throws Exception {
        mvc.perform(MockMvcRequestBuilders.post("/api/v1/projects").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"\",\"targetUrl\":\"ftp://x\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.fieldErrors[*].field", hasItem("name")))
                .andExpect(jsonPath("$.fieldErrors[*].field", hasItem("targetUrl")));
        mvc.perform(MockMvcRequestBuilders.post("/api/v1/projects").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"" + "가".repeat(101) + "\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(MockMvcRequestBuilders.post("/api/v1/projects").contentType(MediaType.APPLICATION_JSON)
                        .content("not json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void unknownProjectIs404Problem() throws Exception {
        mvc.perform(get("/api/v1/projects/{id}", UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
        mvc.perform(get("/api/v1/projects/{id}/activities", UUID.randomUUID()))
                .andExpect(status().isNotFound());
    }

    @Test
    void changingTargetUrlResetsVerification() throws Exception {
        String id = Fixtures.createProject(mvc);
        RUNNER.stubFor(post(urlEqualTo(CHECK_PATH)).willReturn(okJson("{\"reachable\":true,\"statusCode\":200}")));
        mvc.perform(MockMvcRequestBuilders.post("/api/v1/projects/{id}/target-verification", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REACHABLE"));
        mvc.perform(get("/api/v1/projects/{id}", id)).andExpect(jsonPath("$.targetCheckStatusCode").value(200));

        mvc.perform(patch("/api/v1/projects/{id}", id).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"이름만 변경\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.targetUrlStatus").value("REACHABLE"));
        mvc.perform(patch("/api/v1/projects/{id}", id).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"targetUrl\":\"https://other.skrr.dev\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("이름만 변경"))
                .andExpect(jsonPath("$.targetUrl").value("https://other.skrr.dev"))
                .andExpect(jsonPath("$.targetUrlStatus").value("UNVERIFIED"))
                .andExpect(jsonPath("$.targetCheckedAt").isEmpty())
                .andExpect(jsonPath("$.targetCheckStatusCode").isEmpty())
                .andExpect(jsonPath("$.targetCheckMessage").isEmpty());
        mvc.perform(patch("/api/v1/projects/{id}", id).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"   \"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void activitiesLimitIsValidated() throws Exception {
        String id = Fixtures.createProject(mvc);
        mvc.perform(get("/api/v1/projects/{id}/activities?limit=0", id)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        mvc.perform(get("/api/v1/projects/{id}/activities?limit=51", id)).andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/projects/{id}/activities?limit=50", id)).andExpect(status().isOk());
    }

    @Test
    void verifyWithoutTargetUrlIs409() throws Exception {
        String id = Fixtures.createProject(mvc, "{\"name\":\"URL 없음\"}");
        mvc.perform(MockMvcRequestBuilders.post("/api/v1/projects/{id}/target-verification", id))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("TARGET_URL_MISSING"));
    }

    @Test
    void verifyReachableAndUnreachable() throws Exception {
        String id = Fixtures.createProject(mvc);
        RUNNER.stubFor(post(urlEqualTo(CHECK_PATH))
                .withRequestBody(equalToJson("{\"targetUrl\":\"https://shop-mock.skrr.dev\"}"))
                .willReturn(okJson("{\"reachable\":false,\"statusCode\":502,\"message\":\"Bad Gateway\"}")));
        mvc.perform(MockMvcRequestBuilders.post("/api/v1/projects/{id}/target-verification", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UNREACHABLE"))
                .andExpect(jsonPath("$.statusCode").value(502))
                .andExpect(jsonPath("$.message").value("Bad Gateway"))
                .andExpect(jsonPath("$.checkedAt").isString());
        mvc.perform(get("/api/v1/projects/{id}", id))
                .andExpect(jsonPath("$.targetUrlStatus").value("UNREACHABLE"))
                .andExpect(jsonPath("$.targetCheckStatusCode").value(502))
                .andExpect(jsonPath("$.targetCheckMessage").value("Bad Gateway"))
                .andExpect(jsonPath("$.targetCheckedAt").isString());

        // ADR-019: 4xx 도 서버가 응답했으므로 도달 가능 (판정은 실행기), 상태 코드를 함께 저장
        RUNNER.stubFor(post(urlEqualTo(CHECK_PATH)).willReturn(okJson("{\"reachable\":true,\"statusCode\":401}")));
        mvc.perform(MockMvcRequestBuilders.post("/api/v1/projects/{id}/target-verification", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REACHABLE"))
                .andExpect(jsonPath("$.statusCode").value(401))
                .andExpect(jsonPath("$.message").value("연결 확인 성공 (HTTP 401)"));
        mvc.perform(get("/api/v1/projects/{id}", id))
                .andExpect(jsonPath("$.targetCheckStatusCode").value(401))
                .andExpect(jsonPath("$.targetCheckMessage").value("연결 확인 성공 (HTTP 401)"));
        mvc.perform(get("/api/v1/projects/{id}/knowledge-base", id))
                .andExpect(jsonPath("$.readiness[?(@.key=='TARGET_REACHABLE')].satisfied").value(true))
                .andExpect(jsonPath("$.readiness[?(@.key=='TARGET_REACHABLE')].label").value("대상 사이트 접속 가능"));
        mvc.perform(get("/api/v1/projects/{id}/activities", id))
                .andExpect(jsonPath("$.items[0].message")
                        .value("대상 사이트 연결 확인 성공 · https://shop-mock.skrr.dev (HTTP 401)"));

        RUNNER.stubFor(post(urlEqualTo(CHECK_PATH)).willReturn(okJson(
                "{\"reachable\":false,\"statusCode\":null,\"message\":\"10초 안에 응답이 없어요\"}")));
        mvc.perform(MockMvcRequestBuilders.post("/api/v1/projects/{id}/target-verification", id))
                .andExpect(jsonPath("$.status").value("UNREACHABLE"))
                .andExpect(jsonPath("$.statusCode").isEmpty());
        mvc.perform(get("/api/v1/projects/{id}", id))
                .andExpect(jsonPath("$.targetCheckStatusCode").isEmpty())
                .andExpect(jsonPath("$.targetCheckMessage").value("10초 안에 응답이 없어요"));
    }

    @Test
    void runnerOutageIs503AndKeepsPreviousStatus() throws Exception {
        String id = Fixtures.createProject(mvc);
        RUNNER.stubFor(post(urlEqualTo(CHECK_PATH)).willReturn(aResponse().withStatus(500)));
        mvc.perform(MockMvcRequestBuilders.post("/api/v1/projects/{id}/target-verification", id))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("DEPENDENCY_UNAVAILABLE"));
        RUNNER.verify(2, postRequestedFor(urlEqualTo(CHECK_PATH)));

        RUNNER.stubFor(post(urlEqualTo(CHECK_PATH)).willReturn(aResponse().withFault(Fault.CONNECTION_RESET_BY_PEER)));
        mvc.perform(MockMvcRequestBuilders.post("/api/v1/projects/{id}/target-verification", id))
                .andExpect(status().isServiceUnavailable());
        mvc.perform(get("/api/v1/projects/{id}", id)).andExpect(jsonPath("$.targetUrlStatus").value("UNVERIFIED"));
    }

    @Test
    void runnerRejectionIsInternalErrorAndNotStored() throws Exception {
        String id = Fixtures.createProject(mvc);
        RUNNER.stubFor(post(urlEqualTo(CHECK_PATH)).willReturn(aResponse().withStatus(400)
                .withHeader("Content-Type", "application/problem+json")
                .withBody("{\"title\":\"잘못된 요청\",\"status\":400,\"code\":\"INVALID_REQUEST\"}")));
        mvc.perform(MockMvcRequestBuilders.post("/api/v1/projects/{id}/target-verification", id))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"));
        RUNNER.verify(1, postRequestedFor(urlEqualTo(CHECK_PATH)));
        mvc.perform(get("/api/v1/projects/{id}", id))
                .andExpect(jsonPath("$.targetUrlStatus").value("UNVERIFIED"))
                .andExpect(jsonPath("$.targetCheckMessage").isEmpty());
    }
}
