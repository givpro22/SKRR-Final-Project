package com.skrr.platform.request;

import com.skrr.platform.scenario.JsonValues.Reference;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 계약 스키마 TestRequest, TestRequestCreate, RequestCandidate, SelectionRequest. */
public final class TestRequestDtos {

    private TestRequestDtos() {
    }

    /** text 는 앞뒤 공백을 지운 뒤 1~500자 (서비스에서 다시 검사). */
    @Schema(name = "TestRequestCreate")
    public record TestRequestCreate(@NotNull String text) {
    }

    /** candidateId 와 customText 중 하나만 보낸다. */
    @Schema(name = "SelectionRequest")
    public record SelectionRequest(UUID candidateId, String customText) {
    }

    @Schema(name = "RequestCandidate")
    public record CandidateResponse(UUID id, int order, String refinedText, List<Reference> references) {
        static CandidateResponse from(RequestCandidate c) {
            return new CandidateResponse(c.getId(), c.getOrd(), c.getRefinedText(), c.getReferences());
        }
    }

    @Schema(name = "TestRequest")
    public record TestRequestResponse(
            UUID id,
            String code,
            UUID projectId,
            String rawText,
            TestRequestStatus status,
            SelectionSource selectionSource,
            String selectedText,
            List<CandidateResponse> candidates,
            int scenarioCount,
            int testCaseCount,
            String errorMessage,
            Instant createdAt) {

        public static TestRequestResponse from(TestRequest r, List<RequestCandidate> candidates, int scenarioCount,
                                               int testCaseCount) {
            return new TestRequestResponse(r.getId(), r.code(), r.getProjectId(), r.getRawText(), r.getStatus(),
                    r.getSelectionSource(), r.getSelectedText(),
                    candidates.stream().map(CandidateResponse::from).toList(), scenarioCount, testCaseCount,
                    r.getErrorMessage(), r.getCreatedAt());
        }
    }

    @Schema(name = "TestRequestPage")
    public record TestRequestPage(List<TestRequestResponse> items, String nextCursor) {
    }
}
