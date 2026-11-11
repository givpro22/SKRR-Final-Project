package com.skrr.platform.report;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skrr.platform.client.ai.AiClient;
import com.skrr.platform.client.ai.AiJob;
import com.skrr.platform.client.ai.FailureAnalysisRequest;
import com.skrr.platform.client.ai.FailureAnalysisResult;
import com.skrr.platform.common.job.AsyncJob;
import com.skrr.platform.common.job.AsyncJobHandler;
import com.skrr.platform.common.job.InvalidJobResultException;
import com.skrr.platform.common.job.JobType;
import com.skrr.platform.run.ApiCallRepository;
import com.skrr.platform.run.CaseResult;
import com.skrr.platform.run.CaseResultRepository;
import com.skrr.platform.run.GeneratedSpecRepository;
import com.skrr.platform.run.RunEnums.StepStatus;
import com.skrr.platform.run.RunStep;
import com.skrr.platform.run.RunStepRepository;
import com.skrr.platform.run.RunStore;
import com.skrr.platform.run.ScenarioRunRepository;
import com.skrr.platform.run.TestRunRepository;
import com.skrr.platform.run.VerificationRepository;
import com.skrr.platform.scenario.Scenario;
import com.skrr.platform.scenario.ScenarioRepository;
import com.skrr.platform.scenario.TestCase;
import com.skrr.platform.scenario.TestCaseRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.UnaryOperator;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * FAILURE_ANALYZE 작업 (FR-06). FAILED 케이스의 수집 값(단계, API 호출, 교차 검증, spec)을 AI 에 보내 원인 후보를 받는다.
 * 실패 유형은 백엔드 규칙 값을 보내고 AI 는 바꾸지 않는다. 비밀값은 보내지 않는다.
 */
@Component
public class FailureAnalysisJobHandler implements AsyncJobHandler {

    private static final Set<String> SEVERITIES = Set.of("LOW", "MEDIUM", "HIGH", "CRITICAL");
    private static final int MAX_ROOT_CAUSES = 5;

    private final AiClient ai;
    private final CaseResultRepository caseResults;
    private final ScenarioRunRepository scenarioRuns;
    private final TestRunRepository runs;
    private final ScenarioRepository scenarios;
    private final TestCaseRepository testCases;
    private final RunStepRepository steps;
    private final ApiCallRepository apiCalls;
    private final VerificationRepository verifications;
    private final GeneratedSpecRepository specs;
    private final RootCauseCandidateRepository rootCauses;
    private final RunStore store;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate tx;

    public FailureAnalysisJobHandler(AiClient ai, CaseResultRepository caseResults, ScenarioRunRepository scenarioRuns,
                                     TestRunRepository runs, ScenarioRepository scenarios, TestCaseRepository testCases,
                                     RunStepRepository steps, ApiCallRepository apiCalls,
                                     VerificationRepository verifications, GeneratedSpecRepository specs,
                                     RootCauseCandidateRepository rootCauses, RunStore store,
                                     ObjectMapper objectMapper, TransactionTemplate tx) {
        this.ai = ai;
        this.caseResults = caseResults;
        this.scenarioRuns = scenarioRuns;
        this.runs = runs;
        this.scenarios = scenarios;
        this.testCases = testCases;
        this.steps = steps;
        this.apiCalls = apiCalls;
        this.verifications = verifications;
        this.specs = specs;
        this.rootCauses = rootCauses;
        this.store = store;
        this.objectMapper = objectMapper;
        this.tx = tx;
    }

    @Override
    public JobType type() {
        return JobType.FAILURE_ANALYZE;
    }

    @Override
    public AiJob submit(AsyncJob job) {
        FailureAnalysisRequest request = tx.execute(status -> {
            CaseResult cr = caseResults.findById(job.getSubjectId()).orElseThrow();
            cr.analysisStarted();
            return buildRequest(cr);
        });
        return ai.startFailureAnalysis(request);
    }

    FailureAnalysisRequest buildRequest(CaseResult cr) {
        UUID runId = scenarioRuns.findById(cr.getScenarioRunId()).orElseThrow().getRunId();
        UUID projectId = runs.findById(runId).orElseThrow().getProjectId();
        TestCase tc = testCases.findById(cr.getTestCaseId()).orElseThrow();
        Scenario scenario = scenarios.findById(tc.getScenarioId()).orElseThrow();
        RunStore.TestData data = store.testData(projectId);
        UnaryOperator<String> mask = text -> maskSecrets(text, data);

        List<RunStep> all = steps.findByCaseResultIdOrderByAttemptAscOrdAsc(cr.getId());
        int failedAttempt = all.stream().filter(s -> s.getStatus() == StepStatus.FAILED)
                .mapToInt(RunStep::getAttempt).max()
                .orElse(all.stream().mapToInt(RunStep::getAttempt).max().orElse(1));
        List<FailureAnalysisRequest.Step> stepList = all.stream().filter(s -> s.getAttempt() == failedAttempt)
                .map(s -> new FailureAnalysisRequest.Step(s.getOrd(), s.getKind().name(), mask.apply(s.getTitle()),
                        s.getStatus().name(), mask.apply(s.getDetail()), mask.apply(s.getExpectedValue()),
                        mask.apply(s.getActualValue()), s.getSchemaCheck() == null ? null : s.getSchemaCheck().name()))
                .toList();
        List<FailureAnalysisRequest.ApiCall> calls = apiCalls.findByCaseResultIdOrderByIdAsc(cr.getId()).stream()
                .map(a -> new FailureAnalysisRequest.ApiCall(a.getMethod(), mask.apply(a.getPath()), a.getStatusCode(),
                        a.getDurationMs()))
                .toList();
        List<FailureAnalysisRequest.Verification> checks = verifications.findByCaseResultIdOrderByOrdAsc(cr.getId())
                .stream().map(v -> new FailureAnalysisRequest.Verification(v.getItemLabel(), mask.apply(v.getUiValue()),
                        mask.apply(v.getApiValue()), mask.apply(v.getDbValue()), mask.apply(v.getExpectedValue()),
                        v.getVerdict().name()))
                .toList();
        String specSource = cr.getGeneratedSpecId() == null ? null
                : specs.findById(cr.getGeneratedSpecId()).map(s -> mask.apply(s.getSpecSource())).orElse(null);
        return new FailureAnalysisRequest(projectId, tc.getCode(), tc.getTitle(), scenario.getRequirementRef(),
                tc.getExpectedResult(), cr.getFailureType() == null ? "ASSERTION_FAILED" : cr.getFailureType().name(),
                mask.apply(cr.getFailureMessage() == null ? "" : cr.getFailureMessage()), cr.getAttempts(),
                cr.getFailedAttempts(), stepList, calls, checks, null, specSource);
    }

    /** TEST_DATA 비밀값이 어디에 섞여 있어도 *** 로 바꾼다. 실행기가 이미 가렸더라도 한 번 더 막는다. */
    static String maskSecrets(String text, RunStore.TestData data) {
        if (text == null) {
            return null;
        }
        String out = text;
        for (String secret : data.secrets().values()) {
            if (secret != null && !secret.isEmpty()) {
                out = out.replace(secret, "***");
            }
        }
        return out;
    }

    @Override
    public void onProgress(AsyncJob job, AiJob remote) {
        // 분석은 진행 표시가 없다 (UI-04 "분석 중")
    }

    @Override
    public void onSucceeded(AsyncJob job, AiJob remote) {
        FailureAnalysisResult result = parse(remote);
        CaseResult cr = caseResults.findById(job.getSubjectId()).orElseThrow();
        rootCauses.deleteByCaseResultId(cr.getId());
        rootCauses.flush();
        int rank = 1;
        List<FailureAnalysisResult.RootCause> sorted = new ArrayList<>(result.rootCauses());
        sorted.sort((a, b) -> Integer.compare(a.rank() == null ? 99 : a.rank(), b.rank() == null ? 99 : b.rank()));
        for (FailureAnalysisResult.RootCause c : sorted) {
            // 근거 없는 후보는 저장하지 않는다 (state-machines.md 실패 원인 분석)
            List<String> evidence = c.evidence() == null ? List.of()
                    : c.evidence().stream().filter(e -> e != null && !e.isBlank()).toList();
            if (c.description() == null || c.description().isBlank() || evidence.isEmpty()) {
                continue;
            }
            if (rank > MAX_ROOT_CAUSES) {
                break;
            }
            rootCauses.save(new RootCauseCandidate(cr.getId(), rank++, c.description(),
                    c.confidencePct() == null ? 0 : c.confidencePct(), evidence, c.remediation()));
        }
        cr.analysisCompleted(result.severity(), result.affectedFeatures());
    }

    @Override
    public void onFailed(AsyncJob job, String message) {
        caseResults.findById(job.getSubjectId()).ifPresent(cr -> cr.analysisFailed(message));
    }

    private FailureAnalysisResult parse(AiJob remote) {
        if (remote.result() == null || remote.result().isNull()) {
            throw new InvalidJobResultException("AI 분석 작업이 성공했지만 결과가 없습니다");
        }
        FailureAnalysisResult result;
        try {
            result = objectMapper.treeToValue(remote.result(), FailureAnalysisResult.class);
        } catch (JsonProcessingException | IllegalArgumentException ex) {
            throw new InvalidJobResultException("AI 분석 결과 형식이 계약과 다릅니다: " + ex.getMessage());
        }
        if (!"FAILURE_ANALYZE".equals(result.kind()) || !SEVERITIES.contains(result.severity())
                || result.rootCauses() == null || result.affectedFeatures() == null) {
            throw new InvalidJobResultException("AI 분석 결과 형식이 계약과 다릅니다 (kind=" + result.kind()
                    + ", severity=" + result.severity() + ")");
        }
        return result;
    }
}
