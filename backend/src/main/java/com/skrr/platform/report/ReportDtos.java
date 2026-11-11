package com.skrr.platform.report;

import com.skrr.platform.run.CaseResultStatus;
import com.skrr.platform.run.RunDtos.RunResponse;
import com.skrr.platform.run.RunDtos.RunStepResponse;
import com.skrr.platform.run.RunEnums.AnalysisStatus;
import com.skrr.platform.run.RunEnums.ArtifactType;
import com.skrr.platform.run.RunEnums.FailureType;
import com.skrr.platform.run.RunEnums.Verdict;
import com.skrr.platform.run.ScenarioRunStatus;
import com.skrr.platform.scenario.ScenarioStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 계약 스키마 RunReport, ReportScenario, ReportCaseItem, RunComparison, CaseResultDetail, RerunRequest. */
public final class ReportDtos {

    private ReportDtos() {
    }

    public record Kpis(int scenariosPassed, int scenariosTotal, int casesPassed, int casesTotal, int casePassRatePct,
                       int failedCases, int errorCases, int crossCheckMismatches, long durationMs, int apiCallCount) {
    }

    @Schema(name = "ReportCaseItem")
    public record ReportCaseItem(UUID caseResultId, String code, String title, CaseResultStatus status, int attempts,
                                 int failedAttempts, Long durationMs) {
    }

    @Schema(name = "ReportScenario")
    public record ReportScenario(UUID scenarioRunId, String code, String title, String requirementRef,
                                 ScenarioRunStatus status, Long durationMs, int passedCases, int totalCases,
                                 List<ReportCaseItem> cases) {
    }

    public record SkippedScenario(String code, ScenarioStatus status) {
    }

    @Schema(name = "RunComparison")
    public record RunComparison(String previousRunCode, List<String> newFailures, List<String> continuingFailures,
                                List<String> resolved, Integer previousCasePassRatePct) {
        static RunComparison none() {
            return new RunComparison(null, List.of(), List.of(), List.of(), null);
        }
    }

    @Schema(name = "RunReport")
    public record RunReport(RunResponse run, Kpis kpis, List<ReportScenario> scenarios,
                            List<SkippedScenario> skippedScenarios, RunComparison comparison) {
    }

    @Schema(name = "Verification")
    public record VerificationResponse(int order, String itemLabel, String uiValue, String apiValue, String dbValue,
                                       String expectedValue, Verdict verdict) {
    }

    @Schema(name = "RootCauseCandidate")
    public record RootCauseResponse(int rank, String description, int confidencePct, List<String> evidence,
                                    String remediation) {
    }

    @Schema(name = "ArtifactRef")
    public record ArtifactRef(UUID id, ArtifactType type, String label, Long sizeBytes, Instant createdAt) {
    }

    @Schema(name = "CaseResultDetail")
    public record CaseResultDetail(UUID id, String code, String title, String scenarioCode, String scenarioTitle,
                                   String requirementRef, CaseResultStatus status, int attempts, int failedAttempts,
                                   Long durationMs, String severity, FailureType failureType, String failureMessage,
                                   AnalysisStatus analysisStatus, String analysisError, List<String> affectedFeatures,
                                   String firstSeenRunCode, List<VerificationResponse> verifications,
                                   List<RunStepResponse> reproductionSteps, List<RootCauseResponse> rootCauses,
                                   List<ArtifactRef> artifacts) {
    }

    @Schema(name = "RerunRequest")
    public record RerunRequest(List<UUID> caseResultIds) {
    }
}
