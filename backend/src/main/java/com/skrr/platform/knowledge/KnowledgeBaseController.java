package com.skrr.platform.knowledge;

import static com.skrr.platform.common.config.OpenApiConfig.CONFLICT;
import static com.skrr.platform.common.config.OpenApiConfig.NOT_FOUND;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
@Tag(name = "knowledge-base")
public class KnowledgeBaseController {

    private final KnowledgeBaseService knowledgeBases;

    public KnowledgeBaseController(KnowledgeBaseService knowledgeBases) {
        this.knowledgeBases = knowledgeBases;
    }

    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "getKnowledgeBase", summary = "지식 베이스 상태·미리보기·등록 요건 (UI-01 우측, 사이드바 하단)")
    @GetMapping("/projects/{projectId}/knowledge-base")
    public KnowledgeBaseResponse getKnowledgeBase(@PathVariable UUID projectId) {
        return knowledgeBases.get(projectId);
    }

    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @ApiResponse(responseCode = "409", ref = CONFLICT)
    @Operation(operationId = "buildKnowledgeBase", summary = "지식 베이스 구축 (UI-01 \"지식 베이스 구축\")")
    @PostMapping("/projects/{projectId}/knowledge-base/build")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public KnowledgeBaseResponse buildKnowledgeBase(@PathVariable UUID projectId) {
        return knowledgeBases.build(projectId);
    }
}
