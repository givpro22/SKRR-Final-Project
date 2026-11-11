package com.skrr.platform.run;

import com.skrr.platform.common.user.UserController.UserResponse;
import com.skrr.platform.run.RunEnums.CompileStatus;
import com.skrr.platform.run.RunEnums.SchemaCheckStatus;
import com.skrr.platform.run.RunEnums.StepKind;
import com.skrr.platform.run.RunEnums.StepStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 계약 스키마 RunCreate, Run, RunDetail, ScenarioRun, CaseRunSummary, RunStep, RunLogEntry, ApiCall, GeneratedSpec. */
public final class RunDtos {

    private RunDtos() {
    }

    @Schema(name = "RunCreate")
    public record RunCreate(@NotNull @Size(min = 1) List<@NotNull UUID> scenarioIds) {
    }

    @Schema(name = "Run")
    public record RunResponse(UUID id, String code, UUID projectId, UUID testRequestId, UUID rerunOfRunId,
                              RunStatus status, String targetUrl, String targetBuild, String browser,
                              int viewportWidth, int viewportHeight, Map<String, Integer> documentVersions,
                              UserResponse startedBy, String errorMessage, Instant createdAt, Instant startedAt,
                              Instant finishedAt) {

        static RunResponse from(TestRun r, UserResponse startedBy) {
            return new RunResponse(r.getId(), r.code(), r.getProjectId(), r.getTestRequestId(), r.getRerunOfRunId(),
                    r.getStatus(), r.getTargetUrl(), r.getTargetBuild(), r.getBrowser(), r.getViewportWidth(),
                    r.getViewportHeight(), r.getDocumentVersions(), startedBy, r.getErrorMessage(), r.getCreatedAt(),
                    r.getStartedAt(), r.getFinishedAt());
        }
    }

    /** RunDetail.progress. passed+failed+error+skipped+cancelled = finishedScenarios. */
    public record Progress(int totalScenarios, int finishedScenarios, int passed, int failed, int error, int skipped,
                           int cancelled, int running, int waiting) {
    }

    @Schema(name = "RunStep")
    public record RunStepResponse(UUID id, int order, int attempt, StepKind kind, String title, StepStatus status,
                                  String detail, String expectedValue, String actualValue,
                                  SchemaCheckStatus schemaCheck) {
        public static RunStepResponse from(RunStep s) {
            return new RunStepResponse(s.getId(), s.getOrd(), s.getAttempt(), s.getKind(), s.getTitle(), s.getStatus(),
                    s.getDetail(), s.getExpectedValue(), s.getActualValue(), s.getSchemaCheck());
        }
    }

    @Schema(name = "CaseRunSummary")
    public record CaseRunSummary(UUID id, UUID testCaseId, String code, String title, CaseResultStatus status,
                                 int attempts, int failedAttempts, Long durationMs, List<RunStepResponse> steps) {
    }

    @Schema(name = "ScenarioRun")
    public record ScenarioRunResponse(UUID id, UUID scenarioId, String code, String title, String requirementRef,
                                      int order, ScenarioRunStatus status, Long durationMs,
                                      List<CaseRunSummary> cases) {
    }

    @Schema(name = "RunDetail")
    public record RunDetailResponse(UUID id, String code, UUID projectId, UUID testRequestId, UUID rerunOfRunId,
                                    RunStatus status, String targetUrl, String targetBuild, String browser,
                                    int viewportWidth, int viewportHeight, Map<String, Integer> documentVersions,
                                    UserResponse startedBy, String errorMessage, Instant createdAt, Instant startedAt,
                                    Instant finishedAt, Progress progress, List<ScenarioRunResponse> scenarioRuns,
                                    UUID latestScreenshotArtifactId, String currentPath, long lastEventSeq) {
    }

    @Schema(name = "RunPage")
    public record RunPage(List<RunResponse> items, String nextCursor) {
    }

    @Schema(name = "RunLogEntry")
    public record RunLogEntry(long seq, StepKind kind, String message, Instant occurredAt) {
    }

    @Schema(name = "RunLogPage")
    public record RunLogPage(List<RunLogEntry> items, Long nextAfterSeq) {
    }

    @Schema(name = "ApiCall")
    public record ApiCallResponse(long id, String method, String path, Integer statusCode, Integer durationMs,
                                  Instant occurredAt) {
        static ApiCallResponse from(ApiCallEntry a) {
            return new ApiCallResponse(a.getId(), a.getMethod(), a.getPath(), a.getStatusCode(), a.getDurationMs(),
                    a.getOccurredAt());
        }
    }

    @Schema(name = "ApiCallPage")
    public record ApiCallPage(List<ApiCallResponse> items, long totalCount, Integer averageDurationMs,
                              String nextCursor) {
    }

    @Schema(name = "GeneratedSpec")
    public record GeneratedSpecResponse(String testCaseCode, String fileName, String source, String rendererVersion,
                                        CompileStatus compileStatus, String compileError) {
    }
}
