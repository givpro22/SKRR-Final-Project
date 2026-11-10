package com.skrr.platform.support;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.nio.charset.StandardCharsets;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

public final class Fixtures {

    private Fixtures() {
    }

    public static String createProject(MockMvc mvc, String body) throws Exception {
        String json = mvc.perform(post("/api/v1/projects").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(json, "$.id");
    }

    public static String createProject(MockMvc mvc) throws Exception {
        return createProject(mvc, """
                {"name":"목업 쇼핑몰 v1.2","targetUrl":"https://shop-mock.skrr.dev",
                 "queryApiBaseUrl":"https://shop-mock.skrr.dev/api/test/query",
                 "testControlUrl":"https://shop-mock.skrr.dev/api/test"}""");
    }

    public static ResultActions upload(MockMvc mvc, String projectId, String type, String filename, byte[] content)
            throws Exception {
        return mvc.perform(multipart("/api/v1/projects/{projectId}/documents", projectId)
                .file(new MockMultipartFile("file", filename, "application/octet-stream", content))
                .param("type", type));
    }

    public static String uploadOk(MockMvc mvc, String projectId, String type, String filename) throws Exception {
        String content = switch (type) {
            case "TEST_DATA" -> "{\"variables\":{\"a\":\"1\",\"b\":\"2\"},\"secrets\":{\"pw\":\"x\"}}";
            default -> "content of " + filename;
        };
        String json = upload(mvc, projectId, type, filename, content.getBytes(StandardCharsets.UTF_8))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(json, "$.id");
    }

    public static void uploadRequired(MockMvc mvc, String projectId) throws Exception {
        uploadOk(mvc, projectId, "REQUIREMENT", "requirements_v3.pdf");
        uploadOk(mvc, projectId, "API_SPEC", "openapi_shop.yaml");
        uploadOk(mvc, projectId, "CATALOG", "catalog.csv");
    }
}
