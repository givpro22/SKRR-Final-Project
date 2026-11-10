package com.skrr.platform.document;

import static com.skrr.platform.common.config.OpenApiConfig.NOT_FOUND;

import com.skrr.platform.common.error.ApiException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** UI-01 "템플릿 받기". 템플릿은 resources/templates/documents 에 있다. */
@RestController
@RequestMapping("/api/v1")
@Tag(name = "document")
public class DocumentTemplateController {

    private static final Map<DocumentType, String> TEMPLATES = Map.of(
            DocumentType.REQUIREMENT, "requirements_template.docx",
            DocumentType.API_SPEC, "api_spec_template.yaml",
            DocumentType.CATALOG, "catalog_template.csv",
            DocumentType.TEST_DATA, "test_data_template.json");

    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "downloadDocumentTemplate", summary = "문서 템플릿 받기 (UI-01 \"템플릿 받기\")")
    @GetMapping("/document-templates/{documentType}")
    public ResponseEntity<Resource> downloadDocumentTemplate(@PathVariable DocumentType documentType) {
        String filename = TEMPLATES.get(documentType);
        Resource resource = filename == null ? null : new ClassPathResource("templates/documents/" + filename);
        if (resource == null || !resource.exists()) {
            throw ApiException.notFound("템플릿");
        }
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(filename, StandardCharsets.UTF_8).build().toString())
                .body(resource);
    }
}
