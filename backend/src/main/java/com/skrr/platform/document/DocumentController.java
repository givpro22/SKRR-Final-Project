package com.skrr.platform.document;

import io.swagger.v3.oas.annotations.media.Schema;
import static com.skrr.platform.common.config.OpenApiConfig.BAD_REQUEST;
import static com.skrr.platform.common.config.OpenApiConfig.CONFLICT;
import static com.skrr.platform.common.config.OpenApiConfig.NOT_FOUND;
import static com.skrr.platform.common.config.OpenApiConfig.PAYLOAD_TOO_LARGE;

import com.skrr.platform.common.web.ItemsResponse;
import com.skrr.platform.document.storage.FileStorage;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.Instant;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1")
@Tag(name = "document")
public class DocumentController {

    private final DocumentService documents;

    public DocumentController(DocumentService documents) {
        this.documents = documents;
    }

    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "listDocuments", summary = "현재 활성 기준 문서 목록 (UI-01)")
    @GetMapping("/projects/{projectId}/documents")
    public ItemsResponse<DocumentResponse> listDocuments(@PathVariable UUID projectId) {
        return new ItemsResponse<>(documents.listActive(projectId).stream().map(DocumentResponse::from).toList());
    }

    @ApiResponse(responseCode = "400", ref = BAD_REQUEST)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @ApiResponse(responseCode = "413", ref = PAYLOAD_TOO_LARGE)
    @Operation(operationId = "uploadDocument", summary = "기준 문서 업로드 (FR-01, 20MB 이하)")
    @PostMapping(path = "/projects/{projectId}/documents", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public DocumentResponse uploadDocument(@PathVariable UUID projectId,
                                           @RequestParam("type") DocumentType type,
                                           @RequestPart("file") MultipartFile file) {
        return DocumentResponse.from(documents.upload(projectId, type, file));
    }

    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "getDocument", summary = "문서 조회 (인덱싱 진행률 포함)")
    @GetMapping("/documents/{documentId}")
    public DocumentResponse getDocument(@PathVariable UUID documentId) {
        return DocumentResponse.from(documents.get(documentId));
    }

    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @ApiResponse(responseCode = "409", ref = CONFLICT)
    @Operation(operationId = "deleteDocument", summary = "문서 삭제 (UI-01 더보기 메뉴)")
    @DeleteMapping("/documents/{documentId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteDocument(@PathVariable UUID documentId) {
        documents.delete(documentId);
    }

    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "getDocumentDownloadLink", summary = "문서 다운로드 링크 (S3 presigned URL)")
    @GetMapping("/documents/{documentId}/download-link")
    public DownloadLinkResponse getDocumentDownloadLink(@PathVariable UUID documentId) {
        FileStorage.PresignedLink link = documents.downloadLink(documentId);
        return new DownloadLinkResponse(link.url(), link.expiresAt());
    }

    @Schema(name = "DownloadLink")

    public record DownloadLinkResponse(String url, Instant expiresAt) {
    }
}
