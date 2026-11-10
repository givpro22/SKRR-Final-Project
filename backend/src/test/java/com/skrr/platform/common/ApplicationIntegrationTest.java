package com.skrr.platform.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skrr.platform.support.IntegrationTest;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

class ApplicationIntegrationTest extends IntegrationTest {

    @Autowired
    ObjectMapper objectMapper;

    @Test
    void flywayAppliesSchemaAndSeedsDefaultUser() {
        Integer applied = jdbc.queryForObject(
                "select count(*) from flyway_schema_history where success and version in ('1','2','3')", Integer.class);
        assertThat(applied).isEqualTo(3);
        String name = jdbc.queryForObject(
                "select display_name from app_user where id = '00000000-0000-0000-0000-000000000001'", String.class);
        assertThat(name).isEqualTo("기본 사용자");
    }

    @Test
    void healthProbesAreUp() throws Exception {
        mvc.perform(get("/actuator/health")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UP"));
        mvc.perform(get("/actuator/health/liveness")).andExpect(status().isOk());
        mvc.perform(get("/actuator/health/readiness")).andExpect(status().isOk());
    }

    @Test
    void getCurrentUserReturnsDefaultUser() throws Exception {
        mvc.perform(get("/api/v1/me"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("00000000-0000-0000-0000-000000000001"))
                .andExpect(jsonPath("$.displayName").value("기본 사용자"))
                .andExpect(jsonPath("$.roleLabel").value("QA 담당자"));
    }

    @Test
    void unknownPathReturnsProblemWithCode() throws Exception {
        mvc.perform(get("/api/v1/projects/not-a-uuid"))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.title").exists());
        mvc.perform(get("/api/v1/nothing-here"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
    }

    @Test
    void apiDocsExposeImplementedOperationIds() throws Exception {
        String json = mvc.perform(get("/v3/api-docs")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode paths = objectMapper.readTree(json).get("paths");
        List<String> operationIds = new ArrayList<>();
        paths.forEach(path -> path.forEach(op -> {
            if (op.has("operationId")) {
                operationIds.add(op.get("operationId").asText());
            }
        }));
        assertThat(operationIds).contains("getCurrentUser", "listProjects", "createProject", "getProject",
                "updateProject", "verifyTargetSite", "listDocuments", "uploadDocument", "getDocument",
                "deleteDocument", "getDocumentDownloadLink", "downloadDocumentTemplate", "getKnowledgeBase",
                "buildKnowledgeBase", "listActivities");
    }
}
