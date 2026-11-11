package com.skrr.platform.run;

import static com.skrr.platform.common.config.OpenApiConfig.BAD_REQUEST;
import static com.skrr.platform.common.config.OpenApiConfig.CONFLICT;
import static com.skrr.platform.common.config.OpenApiConfig.NOT_FOUND;

import com.skrr.platform.document.DocumentController.DownloadLinkResponse;
import com.skrr.platform.document.storage.FileStorage;
import com.skrr.platform.run.RunDtos.ApiCallPage;
import com.skrr.platform.run.RunDtos.GeneratedSpecResponse;
import com.skrr.platform.run.RunDtos.RunCreate;
import com.skrr.platform.run.RunDtos.RunDetailResponse;
import com.skrr.platform.run.RunDtos.RunLogPage;
import com.skrr.platform.run.RunDtos.RunPage;
import com.skrr.platform.run.RunDtos.RunResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/v1")
public class RunController {

    private final RunService runs;
    private final RunQueryService queries;
    private final RunEventStreams streams;

    public RunController(RunService runs, RunQueryService queries, RunEventStreams streams) {
        this.runs = runs;
        this.queries = queries;
        this.streams = streams;
    }

    @Tag(name = "run")
    @ApiResponse(responseCode = "400", ref = BAD_REQUEST)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @ApiResponse(responseCode = "409", ref = CONFLICT)
    @Operation(operationId = "startRun",
            summary = "체크한 승인 시나리오로 테스트 실행 (UI-02-5 \"테스트 실행\", FR-04, FR-05)")
    @PostMapping("/test-requests/{testRequestId}/runs")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public RunResponse startRun(@PathVariable UUID testRequestId, @Valid @RequestBody RunCreate request) {
        return runs.start(testRequestId, request.scenarioIds());
    }

    @Tag(name = "run")
    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "listRuns", summary = "실행 목록 (사이드바 \"실행 모니터\", \"리포트\")")
    @GetMapping("/projects/{projectId}/runs")
    public RunPage listRuns(@PathVariable UUID projectId, @RequestParam(required = false) String cursor,
                            @RequestParam(defaultValue = "50") @Min(1) @Max(200) int limit) {
        return queries.list(projectId, cursor, limit);
    }

    @Tag(name = "run")
    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "getRun", summary = "실행 현재 상태 스냅샷 (UI-03 첫 진입과 SSE 재연결 시 사용)")
    @GetMapping("/runs/{runId}")
    public RunDetailResponse getRun(@PathVariable UUID runId) {
        return queries.detail(runId);
    }

    @Tag(name = "run")
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @ApiResponse(responseCode = "409", ref = CONFLICT)
    @Operation(operationId = "cancelRun", summary = "실행 중단 (UI-03 \"실행 중단\")")
    @PostMapping("/runs/{runId}/cancel")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public RunResponse cancelRun(@PathVariable UUID runId) {
        return runs.cancel(runId);
    }

    @Tag(name = "run")
    @ApiResponse(responseCode = "200", description = "Server-Sent Events 스트림")
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "streamRunEvents",
            summary = "실행 실시간 이벤트 SSE (UI-03, WBS 4.3.6). 형식은 docs/contracts/events.md")
    @GetMapping(path = "/runs/{runId}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamRunEvents(@PathVariable UUID runId,
                                      @RequestParam(required = false) @Min(0) Long afterSeq,
                                      @Parameter(name = "Last-Event-ID")
                                      @RequestHeader(name = "Last-Event-ID", required = false) String lastEventId,
                                      HttpServletResponse response) {
        TestRun run = queries.find(runId);
        long start = afterSeq == null ? 0 : afterSeq;
        if (lastEventId != null && !lastEventId.isBlank()) {
            try {
                start = Long.parseLong(lastEventId.trim());
            } catch (NumberFormatException ignored) {
                // 잘못된 값이면 afterSeq 를 쓴다
            }
        }
        response.setHeader("X-Accel-Buffering", "no");
        response.setHeader("Cache-Control", "no-cache");
        return streams.subscribe(runId, start, run.getStatus().isTerminal());
    }

    @Tag(name = "run")
    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "listRunLogs", summary = "저장된 실행 로그 조회")
    @GetMapping("/runs/{runId}/logs")
    public RunLogPage listRunLogs(@PathVariable UUID runId, @RequestParam(required = false) @Min(0) Long afterSeq,
                                  @RequestParam(defaultValue = "50") @Min(1) @Max(200) int limit) {
        return queries.logs(runId, afterSeq == null ? 0 : afterSeq, limit);
    }

    @Tag(name = "run")
    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "listRunApiCalls", summary = "API 호출 목록과 집계 (UI-03 \"API 호출\" 패널)")
    @GetMapping("/runs/{runId}/api-calls")
    public ApiCallPage listRunApiCalls(@PathVariable UUID runId, @RequestParam(required = false) String cursor,
                                       @RequestParam(defaultValue = "50") @Min(1) @Max(200) int limit) {
        return queries.apiCalls(runId, cursor, limit);
    }

    @Tag(name = "report")
    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "getCaseResultSpec", summary = "실행한 Playwright spec 코드 (UI-03 \"spec 코드 보기\")")
    @GetMapping("/case-results/{caseResultId}/spec")
    public GeneratedSpecResponse getCaseResultSpec(@PathVariable UUID caseResultId) {
        return queries.spec(caseResultId);
    }

    @Tag(name = "report")
    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "getArtifactDownloadLink", summary = "실행 증거 링크 (스크린샷, trace, HAR)")
    @GetMapping("/artifacts/{artifactId}/download-link")
    public DownloadLinkResponse getArtifactDownloadLink(@PathVariable UUID artifactId) {
        FileStorage.PresignedLink link = queries.artifactLink(artifactId);
        return new DownloadLinkResponse(link.url(), link.expiresAt());
    }
}
