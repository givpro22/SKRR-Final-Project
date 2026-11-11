package com.skrr.platform.report;

import com.skrr.platform.common.error.ApiException;
import com.skrr.platform.common.error.ErrorCode;
import com.skrr.platform.report.ReportDtos.ArtifactRef;
import com.skrr.platform.report.ReportDtos.CaseResultDetail;
import com.skrr.platform.report.ReportDtos.Kpis;
import com.skrr.platform.report.ReportDtos.ReportCaseItem;
import com.skrr.platform.report.ReportDtos.ReportScenario;
import com.skrr.platform.report.ReportDtos.RootCauseResponse;
import com.skrr.platform.report.ReportDtos.RunComparison;
import com.skrr.platform.report.ReportDtos.RunReport;
import com.skrr.platform.report.ReportDtos.SkippedScenario;
import com.skrr.platform.report.ReportDtos.VerificationResponse;
import com.skrr.platform.run.ApiCallRepository;
import com.skrr.platform.run.ArtifactRepository;
import com.skrr.platform.run.CaseResult;
import com.skrr.platform.run.CaseResultRepository;
import com.skrr.platform.run.CaseResultStatus;
import com.skrr.platform.run.RunDtos.RunStepResponse;
import com.skrr.platform.run.RunEnums.AnalysisStatus;
import com.skrr.platform.run.RunEnums.StepStatus;
import com.skrr.platform.run.RunEnums.Verdict;
import com.skrr.platform.run.RunQueryService;
import com.skrr.platform.run.RunStep;
import com.skrr.platform.run.RunStepRepository;
import com.skrr.platform.run.ScenarioRun;
import com.skrr.platform.run.ScenarioRunRepository;
import com.skrr.platform.run.ScenarioRunStatus;
import com.skrr.platform.run.TestRun;
import com.skrr.platform.run.TestRunRepository;
import com.skrr.platform.run.VerificationRepository;
import com.skrr.platform.scenario.Scenario;
import com.skrr.platform.scenario.ScenarioRepository;
import com.skrr.platform.scenario.TestCase;
import com.skrr.platform.scenario.TestCaseRepository;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 결과 리포트 (UI-04, FR-06, FR-07). 지표는 DB 값으로 계산하고, kpis·scenarios·케이스 수가 서로 맞는다. */
@Service
@Transactional(readOnly = true)
public class ReportService {

    private final TestRunRepository runs;
    private final ScenarioRunRepository scenarioRuns;
    private final CaseResultRepository caseResults;
    private final RunStepRepository steps;
    private final VerificationRepository verifications;
    private final ApiCallRepository apiCalls;
    private final ArtifactRepository artifacts;
    private final RootCauseCandidateRepository rootCauses;
    private final ScenarioRepository scenarios;
    private final TestCaseRepository testCases;
    private final RunQueryService runQueries;
    private final RunComparisons comparisons;

    public ReportService(TestRunRepository runs, ScenarioRunRepository scenarioRuns, CaseResultRepository caseResults,
                         RunStepRepository steps, VerificationRepository verifications, ApiCallRepository apiCalls,
                         ArtifactRepository artifacts, RootCauseCandidateRepository rootCauses,
                         ScenarioRepository scenarios, TestCaseRepository testCases, RunQueryService runQueries,
                         RunComparisons comparisons) {
        this.runs = runs;
        this.scenarioRuns = scenarioRuns;
        this.caseResults = caseResults;
        this.steps = steps;
        this.verifications = verifications;
        this.apiCalls = apiCalls;
        this.artifacts = artifacts;
        this.rootCauses = rootCauses;
        this.scenarios = scenarios;
        this.testCases = testCases;
        this.runQueries = runQueries;
        this.comparisons = comparisons;
    }

    /** operationId: getRunReport. 실행이 끝나기 전에는 409 RUN_NOT_FINISHED. 분석은 기다리지 않는다. */
    public RunReport report(UUID runId) {
        TestRun run = runs.findById(runId).orElseThrow(() -> ApiException.notFound("실행"));
        if (!run.getStatus().isTerminal()) {
            throw new ApiException(ErrorCode.RUN_NOT_FINISHED, "실행이 끝난 뒤 리포트를 볼 수 있습니다 (현재 "
                    + run.getStatus() + ").");
        }
        List<ScenarioRun> srs = scenarioRuns.findByRunIdOrderByOrdAsc(runId);
        Map<UUID, Scenario> scenarioById = scenarios.findAllById(srs.stream().map(ScenarioRun::getScenarioId).toList())
                .stream().collect(Collectors.toMap(Scenario::getId, Function.identity()));
        List<CaseResult> crs = srs.isEmpty() ? List.of()
                : caseResults.findByScenarioRunIdIn(srs.stream().map(ScenarioRun::getId).toList());
        Map<UUID, TestCase> caseById = testCases.findAllById(crs.stream().map(CaseResult::getTestCaseId).toList())
                .stream().collect(Collectors.toMap(TestCase::getId, Function.identity()));
        Map<UUID, List<CaseResult>> bySr = crs.stream().collect(Collectors.groupingBy(CaseResult::getScenarioRunId));

        List<ReportScenario> reportScenarios = new ArrayList<>();
        for (ScenarioRun sr : srs) {
            Scenario s = scenarioById.get(sr.getScenarioId());
            List<CaseResult> cases = bySr.getOrDefault(sr.getId(), List.of()).stream()
                    .sorted(Comparator.comparingInt(cr -> caseById.get(cr.getTestCaseId()).getOrd())).toList();
            List<ReportCaseItem> items = cases.stream().map(cr -> {
                TestCase tc = caseById.get(cr.getTestCaseId());
                return new ReportCaseItem(cr.getId(), tc.getCode(), tc.getTitle(), cr.getStatus(), cr.getAttempts(),
                        cr.getFailedAttempts(), cr.getDurationMs());
            }).toList();
            int passed = (int) cases.stream().filter(cr -> cr.getStatus() == CaseResultStatus.PASSED).count();
            reportScenarios.add(new ReportScenario(sr.getId(), s.getCode(), s.getTitle(), s.getRequirementRef(),
                    sr.getStatus(), sr.getDurationMs(), passed, cases.size(), items));
        }

        int casesPassed = count(crs, CaseResultStatus.PASSED);
        int mismatches = crs.stream().mapToInt(cr -> (int) verifications.findByCaseResultIdOrderByOrdAsc(cr.getId())
                .stream().filter(v -> v.getVerdict() == Verdict.MISMATCH).count()).sum();
        long duration = run.getStartedAt() == null || run.getFinishedAt() == null ? 0
                : Duration.between(run.getStartedAt(), run.getFinishedAt()).toMillis();
        Kpis kpis = new Kpis(
                (int) srs.stream().filter(sr -> sr.getStatus() == ScenarioRunStatus.PASSED).count(), srs.size(),
                casesPassed, crs.size(), passRate(casesPassed, crs.size()), count(crs, CaseResultStatus.FAILED),
                count(crs, CaseResultStatus.ERROR), mismatches, duration, (int) apiCalls.countByRunId(runId));

        Set<UUID> included = srs.stream().map(ScenarioRun::getScenarioId).collect(Collectors.toSet());
        List<SkippedScenario> skipped = scenarios.findByTestRequestIdOrderByCodeAsc(run.getTestRequestId()).stream()
                .filter(s -> !included.contains(s.getId()))
                .map(s -> new SkippedScenario(s.getCode(), s.getStatus())).toList();

        return new RunReport(runQueries.view(run), kpis, reportScenarios, skipped, comparison(run, crs, caseById));
    }

    private RunComparison comparison(TestRun run, List<CaseResult> current, Map<UUID, TestCase> caseById) {
        Optional<TestRun> previous = comparisons.target(run);
        if (previous.isEmpty()) {
            return RunComparison.none();
        }
        Map<UUID, CaseResult> before = comparisons.casesByTestCase(previous.get().getId());
        List<String> newFailures = new ArrayList<>();
        List<String> continuing = new ArrayList<>();
        List<String> resolved = new ArrayList<>();
        current.stream().sorted(Comparator.comparing(cr -> caseById.get(cr.getTestCaseId()).getCode()))
                .forEach(cr -> {
                    String code = caseById.get(cr.getTestCaseId()).getCode();
                    CaseResult prev = before.get(cr.getTestCaseId());
                    boolean failedBefore = prev != null && prev.getStatus() == CaseResultStatus.FAILED;
                    if (cr.getStatus() == CaseResultStatus.FAILED) {
                        (failedBefore ? continuing : newFailures).add(code);
                    } else if (cr.getStatus() == CaseResultStatus.PASSED && failedBefore) {
                        resolved.add(code);
                    }
                });
        List<CaseResult> previousCases = new ArrayList<>(before.values());
        int previousRate = passRate(count(previousCases, CaseResultStatus.PASSED), previousCases.size());
        return new RunComparison(previous.get().code(), newFailures, continuing, resolved, previousRate);
    }

    /** operationId: getCaseResult. 재현 단계는 마지막으로 실패한 시도, 통과했으면 마지막 시도. */
    public CaseResultDetail caseResult(UUID caseResultId) {
        CaseResult cr = caseResults.findById(caseResultId).orElseThrow(() -> ApiException.notFound("케이스 결과"));
        TestCase tc = testCases.findById(cr.getTestCaseId()).orElseThrow();
        Scenario scenario = scenarios.findById(tc.getScenarioId()).orElseThrow();
        List<RunStep> all = steps.findByCaseResultIdOrderByAttemptAscOrdAsc(cr.getId());
        int lastAttempt = all.stream().mapToInt(RunStep::getAttempt).max().orElse(0);
        int attempt = all.stream().filter(s -> s.getStatus() == StepStatus.FAILED).mapToInt(RunStep::getAttempt)
                .max().orElse(lastAttempt);
        List<RunStepResponse> reproduction = all.stream().filter(s -> s.getAttempt() == attempt)
                .map(RunStepResponse::from).toList();
        List<VerificationResponse> checks = verifications.findByCaseResultIdOrderByOrdAsc(cr.getId()).stream()
                .map(v -> new VerificationResponse(v.getOrd(), v.getItemLabel(), v.getUiValue(), v.getApiValue(),
                        v.getDbValue(), v.getExpectedValue(), v.getVerdict())).toList();
        List<RootCauseResponse> causes = cr.getAnalysisStatus() != AnalysisStatus.COMPLETED ? List.of()
                : rootCauses.findByCaseResultIdOrderByRankAsc(cr.getId()).stream()
                        .map(r -> new RootCauseResponse(r.getRank(), r.getDescription(), r.getConfidencePct(),
                                r.getEvidence(), r.getRemediation())).toList();
        List<ArtifactRef> evidence = artifacts.findByCaseResultIdOrderByCreatedAtAsc(cr.getId()).stream()
                .map(a -> new ArtifactRef(a.getId(), a.getType(), a.getLabel(), a.getSizeBytes(), a.getCreatedAt()))
                .toList();
        String firstSeen = cr.getFirstSeenRunId() == null ? null
                : runs.findById(cr.getFirstSeenRunId()).map(TestRun::code).orElse(null);
        return new CaseResultDetail(cr.getId(), tc.getCode(), tc.getTitle(), scenario.getCode(), scenario.getTitle(),
                scenario.getRequirementRef(), cr.getStatus(), cr.getAttempts(), cr.getFailedAttempts(),
                cr.getDurationMs(), cr.getSeverity(), cr.getFailureType(), cr.getFailureMessage(),
                cr.getAnalysisStatus(), cr.getAnalysisError(), cr.getAffectedFeatures(), firstSeen, checks,
                reproduction, causes, evidence);
    }

    private static int count(List<CaseResult> crs, CaseResultStatus status) {
        return (int) crs.stream().filter(cr -> cr.getStatus() == status).count();
    }

    /** casesPassed / casesTotal × 100 반올림. 분모는 실행에 포함된 모든 케이스(ERROR·SKIPPED·CANCELLED 포함). */
    static int passRate(int passed, int total) {
        return total == 0 ? 0 : (int) Math.round(passed * 100.0 / total);
    }
}
