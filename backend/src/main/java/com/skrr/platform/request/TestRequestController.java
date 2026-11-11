package com.skrr.platform.request;

import static com.skrr.platform.common.config.OpenApiConfig.BAD_REQUEST;
import static com.skrr.platform.common.config.OpenApiConfig.CONFLICT;
import static com.skrr.platform.common.config.OpenApiConfig.NOT_FOUND;

import com.skrr.platform.request.TestRequestDtos.SelectionRequest;
import com.skrr.platform.request.TestRequestDtos.TestRequestCreate;
import com.skrr.platform.request.TestRequestDtos.TestRequestPage;
import com.skrr.platform.request.TestRequestDtos.TestRequestResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
@Tag(name = "test-request")
public class TestRequestController {

    private final TestRequestService requests;

    public TestRequestController(TestRequestService requests) {
        this.requests = requests;
    }

    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "listTestRequests", summary = "테스트 요청 목록 (사이드바 \"테스트 요청\")")
    @GetMapping("/projects/{projectId}/test-requests")
    public TestRequestPage listTestRequests(@PathVariable UUID projectId,
                                            @RequestParam(required = false) String cursor,
                                            @RequestParam(defaultValue = "50") @Min(1) @Max(200) int limit) {
        return requests.list(projectId, cursor, limit);
    }

    @ApiResponse(responseCode = "400", ref = BAD_REQUEST)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @ApiResponse(responseCode = "409", ref = CONFLICT)
    @Operation(operationId = "createTestRequest", summary = "자연어 테스트 요청 생성 (UI-02-1, FR-02)")
    @PostMapping("/projects/{projectId}/test-requests")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public TestRequestResponse createTestRequest(@PathVariable UUID projectId,
                                                 @Valid @RequestBody TestRequestCreate request) {
        return requests.create(projectId, request.text());
    }

    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "getTestRequest", summary = "요청과 후보 조회 (UI-02-1B). 생성 중에는 2초 간격으로 조회한다.")
    @GetMapping("/test-requests/{testRequestId}")
    public TestRequestResponse getTestRequest(@PathVariable UUID testRequestId) {
        return requests.get(testRequestId);
    }

    @ApiResponse(responseCode = "400", ref = BAD_REQUEST)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @ApiResponse(responseCode = "409", ref = CONFLICT)
    @Operation(operationId = "selectRefinedRequest",
            summary = "후보 1개 선택 또는 직접 입력 후 시나리오 생성 시작 (UI-02-1B, WBS 4.5.6)")
    @PostMapping("/test-requests/{testRequestId}/selection")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public TestRequestResponse selectRefinedRequest(@PathVariable UUID testRequestId,
                                                    @RequestBody SelectionRequest selection) {
        return requests.select(testRequestId, selection);
    }
}
