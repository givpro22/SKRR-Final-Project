package com.skrr.platform.document;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.skrr.platform.support.Fixtures;
import com.skrr.platform.support.IntegrationTest;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

class DocumentApiIntegrationTest extends IntegrationTest {

    @Test
    void uploadStoresFileAndMetadata() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        byte[] content = "요구사항 FR-CART-01".getBytes(StandardCharsets.UTF_8);
        String json = Fixtures.upload(mvc, projectId, "REQUIREMENT", "requirements_v3.pdf", content)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.projectId").value(projectId))
                .andExpect(jsonPath("$.type").value("REQUIREMENT"))
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.isActive").value(true))
                .andExpect(jsonPath("$.originalFilename").value("requirements_v3.pdf"))
                .andExpect(jsonPath("$.contentType").value("application/pdf"))
                .andExpect(jsonPath("$.sizeBytes").value(content.length))
                .andExpect(jsonPath("$.status").value("UPLOADED"))
                .andExpect(jsonPath("$.indexProgress").value(0))
                .andExpect(jsonPath("$.summary").isMap())
                .andExpect(jsonPath("$.errorMessage").isEmpty())
                .andExpect(jsonPath("$.createdAt").isString())
                .andReturn().getResponse().getContentAsString();
        String id = JsonPath.read(json, "$.id");

        String key = jdbc.queryForObject("select s3_key from document where id = ?::uuid", String.class, id);
        assertThat(key).startsWith("requirements/" + projectId + "/").endsWith("_requirements_v3.pdf");
        assertThat(Files.readAllBytes(STORAGE_DIR.resolve(key))).isEqualTo(content);
        String checksum = jdbc.queryForObject("select checksum_sha256 from document where id = ?::uuid",
                String.class, id);
        assertThat(checksum).isEqualTo(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content)));

        mvc.perform(get("/api/v1/documents/{id}", id)).andExpect(status().isOk()).andExpect(jsonPath("$.id").value(id));
        mvc.perform(get("/api/v1/projects/{id}/activities", projectId))
                .andExpect(jsonPath("$.items[0].message").value("requirements_v3.pdf 업로드 · 요구사항 명세서 v1 저장"));
    }

    @Test
    void reuploadDeactivatesPreviousAndIncrementsVersion() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        String first = Fixtures.uploadOk(mvc, projectId, "API_SPEC", "openapi_v1.yaml");
        Fixtures.uploadOk(mvc, projectId, "CATALOG", "catalog.json");
        String second = Fixtures.uploadOk(mvc, projectId, "API_SPEC", "openapi_v2.yml");

        mvc.perform(get("/api/v1/projects/{id}/documents", projectId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.items[0].id").value(second))
                .andExpect(jsonPath("$.items[0].version").value(2))
                .andExpect(jsonPath("$.items[0].contentType").value("application/yaml"))
                .andExpect(jsonPath("$.items[1].type").value("CATALOG"));
        mvc.perform(get("/api/v1/documents/{id}", first))
                .andExpect(jsonPath("$.isActive").value(false))
                .andExpect(jsonPath("$.version").value(1));
    }

    @Test
    void rejectsWrongExtensionEmptyFileAndBadType() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        Fixtures.upload(mvc, projectId, "REQUIREMENT", "spec.yaml", "x".getBytes())
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("UNSUPPORTED_FILE_TYPE"))
                .andExpect(jsonPath("$.allowedExtensions[0]").value("docx"));
        Fixtures.upload(mvc, projectId, "CATALOG", "catalog", "x".getBytes())
                .andExpect(jsonPath("$.code").value("UNSUPPORTED_FILE_TYPE"));
        Fixtures.upload(mvc, projectId, "CATALOG", "catalog.csv", new byte[0])
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        Fixtures.upload(mvc, projectId, "UNKNOWN", "catalog.csv", "x".getBytes())
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        Fixtures.upload(mvc, UUID.randomUUID().toString(), "CATALOG", "catalog.csv", "x".getBytes())
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
        assertThat(jdbc.queryForObject("select count(*) from document", Integer.class)).isZero();
    }

    @Test
    void testDataIsRegisteredWithoutIndexingAndValidated() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        Fixtures.upload(mvc, projectId, "TEST_DATA", "seed_accounts.json",
                        "{\"variables\":{\"memberEmail\":\"a@b\"},\"secrets\":{\"pw\":\"s\",\"pw2\":\"t\"}}".getBytes())
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("REGISTERED"))
                .andExpect(jsonPath("$.summary.variableCount").value(1))
                .andExpect(jsonPath("$.summary.secretCount").value(2));
        Fixtures.upload(mvc, projectId, "TEST_DATA", "bad.json", "[1,2]".getBytes())
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        Fixtures.upload(mvc, projectId, "TEST_DATA", "bad.json", "{\"secrets\":[\"x\"]}".getBytes())
                .andExpect(status().isBadRequest());
    }

    @Test
    void deleteRemovesRowAndFile() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        String id = Fixtures.uploadOk(mvc, projectId, "CATALOG", "catalog.csv");
        String key = jdbc.queryForObject("select s3_key from document where id = ?::uuid", String.class, id);
        assertThat(STORAGE_DIR.resolve(key)).exists();

        mvc.perform(delete("/api/v1/documents/{id}", id)).andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/documents/{id}", id)).andExpect(status().isNotFound());
        assertThat(STORAGE_DIR.resolve(key)).doesNotExist();
        mvc.perform(delete("/api/v1/documents/{id}", id)).andExpect(status().isNotFound());
    }

    @Test
    void downloadLinkServesFileUntilExpiry() throws Exception {
        String projectId = Fixtures.createProject(mvc);
        String id = Fixtures.uploadOk(mvc, projectId, "CATALOG", "카탈로그 v2.csv");
        String json = mvc.perform(get("/api/v1/documents/{id}/download-link", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.expiresAt").isString())
                .andReturn().getResponse().getContentAsString();
        String url = JsonPath.read(json, "$.url");
        assertThat(url).startsWith("http://");

        String path = URI.create(url).getRawPath() + "?" + URI.create(url).getRawQuery();
        ResponseEntity<byte[]> file = rest.getForEntity(URI.create(rest.getRootUri() + path), byte[].class);
        assertThat(file.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(new String(file.getBody(), StandardCharsets.UTF_8)).isEqualTo("content of 카탈로그 v2.csv");
        assertThat(file.getHeaders().getContentDisposition().getFilename()).isEqualTo("카탈로그 v2.csv");

        ResponseEntity<String> tampered = rest.getForEntity(
                URI.create(rest.getRootUri() + path.replaceAll("signature=[0-9a-f]+", "signature=00")), String.class);
        assertThat(tampered.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void downloadLinkUsesForwardedHeadersFromTrustedProxy() throws Exception {
        // 실제 Tomcat(RemoteIpValve, native)으로 확인한다. 테스트 클라이언트는 루프백이라 믿는 프록시다.
        String projectId = Fixtures.createProject(mvc);
        String id = Fixtures.uploadOk(mvc, projectId, "CATALOG", "catalog.csv");

        String viaNginx = downloadUrl(id, Map.of("X-Forwarded-Proto", "http",
                "X-Forwarded-Host", "localhost:3000", "X-Forwarded-Port", "3000"));
        assertThat(viaNginx).startsWith("http://localhost:3000/api/local-storage/catalog/" + projectId + "/");

        String viaTls = downloadUrl(id, Map.of("X-Forwarded-Proto", "https", "X-Forwarded-Host", "skrr.example.test"));
        assertThat(viaTls).startsWith("https://skrr.example.test/api/local-storage/");

        assertThat(downloadUrl(id, Map.of())).startsWith(rest.getRootUri() + "/api/local-storage/");
    }

    String downloadUrl(String documentId, Map<String, String> forwarded) {
        HttpHeaders headers = new HttpHeaders();
        forwarded.forEach(headers::add);
        ResponseEntity<String> response = rest.exchange("/api/v1/documents/{id}/download-link", HttpMethod.GET,
                new HttpEntity<>(headers), String.class, documentId);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return JsonPath.read(response.getBody(), "$.url");
    }

    @ParameterizedTest
    @EnumSource(DocumentType.class)
    void templatesAreDownloadable(DocumentType type) throws Exception {
        mvc.perform(get("/api/v1/document-templates/{type}", type.name()))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_OCTET_STREAM))
                .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION,
                        org.hamcrest.Matchers.startsWith("attachment")));
    }

    @Test
    void sizeLimitIs20MegabytesInRealServer() {
        String projectId;
        try {
            projectId = Fixtures.createProject(mvc);
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
        assertThat(uploadOfSize(projectId, 20 * 1024 * 1024).getStatusCode()).isEqualTo(HttpStatus.CREATED);

        ResponseEntity<String> tooLarge = uploadOfSize(projectId, 20 * 1024 * 1024 + 1);
        assertThat(tooLarge.getStatusCode()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE);
        assertThat(tooLarge.getBody()).contains("\"code\":\"FILE_TOO_LARGE\"");

        ResponseEntity<String> wayTooLarge = uploadOfSize(projectId, 22 * 1024 * 1024);
        assertThat(wayTooLarge.getStatusCode()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE);
        assertThat(wayTooLarge.getBody()).contains("\"code\":\"FILE_TOO_LARGE\"");
    }

    private ResponseEntity<String> uploadOfSize(String projectId, int size) {
        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("type", "API_SPEC");
        body.add("file", new ByteArrayResource(new byte[size]) {
            @Override
            public String getFilename() {
                return "big.json";
            }
        });
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);
        return rest.postForEntity("/api/v1/projects/{id}/documents", new HttpEntity<>(body, headers), String.class,
                projectId);
    }
}
