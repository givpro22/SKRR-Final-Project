package com.skrr.platform.run;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skrr.platform.client.ai.GeneratedScenario.GeneratedCase;
import com.skrr.platform.document.Document;
import com.skrr.platform.document.DocumentRepository;
import com.skrr.platform.document.DocumentType;
import com.skrr.platform.document.storage.FileStorage;
import com.skrr.platform.project.Project;
import com.skrr.platform.project.ProjectRepository;
import com.skrr.platform.run.RunEnums.ArtifactType;
import com.skrr.platform.run.RunEnums.CompileStatus;
import com.skrr.platform.run.RunEnums.FailureType;
import com.skrr.platform.run.RunEnums.SchemaCheckStatus;
import com.skrr.platform.run.RunEnums.StepKind;
import com.skrr.platform.run.RunEnums.StepStatus;
import com.skrr.platform.scenario.Scenario;
import com.skrr.platform.scenario.ScenarioRepository;
import com.skrr.platform.scenario.TestCase;
import com.skrr.platform.scenario.TestCaseRepository;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** 실행 작업자가 쓰는 DB 작업. 메서드마다 짧은 트랜잭션이다(긴 외부 호출을 트랜잭션 안에 두지 않음). */
@Component
@Transactional
public class RunStore {

    private final TestRunRepository runs;
    private final ScenarioRunRepository scenarioRuns;
    private final CaseResultRepository caseResults;
    private final RunStepRepository steps;
    private final VerificationRepository verifications;
    private final ApiCallRepository apiCalls;
    private final ArtifactRepository artifacts;
    private final GeneratedSpecRepository specs;
    private final ScenarioRepository scenarios;
    private final TestCaseRepository testCases;
    private final ProjectRepository projects;
    private final DocumentRepository documents;
    private final FileStorage storage;
    private final ObjectMapper objectMapper;

    public RunStore(TestRunRepository runs, ScenarioRunRepository scenarioRuns, CaseResultRepository caseResults,
                    RunStepRepository steps, VerificationRepository verifications, ApiCallRepository apiCalls,
                    ArtifactRepository artifacts, GeneratedSpecRepository specs, ScenarioRepository scenarios,
                    TestCaseRepository testCases, ProjectRepository projects, DocumentRepository documents,
                    FileStorage storage, ObjectMapper objectMapper) {
        this.runs = runs;
        this.scenarioRuns = scenarioRuns;
        this.caseResults = caseResults;
        this.steps = steps;
        this.verifications = verifications;
        this.apiCalls = apiCalls;
        this.artifacts = artifacts;
        this.specs = specs;
        this.scenarios = scenarios;
        this.testCases = testCases;
        this.projects = projects;
        this.documents = documents;
        this.storage = storage;
        this.objectMapper = objectMapper;
    }

    public record RunPlan(UUID runId, String runCode, UUID projectId, String targetUrl, String testControlUrl,
                          String queryApiBaseUrl, int viewportWidth, int viewportHeight, List<ScenarioPlan> scenarios) {
        public List<CasePlan> allCases() {
            return scenarios.stream().flatMap(s -> s.cases().stream()).toList();
        }
    }

    public record ScenarioPlan(UUID scenarioRunId, String code, String title, String requirementRef,
                               List<CasePlan> cases) {
    }

    public record CasePlan(UUID caseResultId, UUID testCaseId, String code, int version, GeneratedCase content,
                           ScenarioPlan scenario) {
    }

    /** 활성 TEST_DATA 의 값. 비밀값은 실행기에만 넘기고 저장·로그에 쓰지 않는다. */
    public record TestData(Map<String, String> variables, Map<String, String> secrets) {
        public List<String> names() {
            List<String> names = new ArrayList<>(variables.keySet());
            names.addAll(secrets.keySet());
            return names;
        }
    }

    @Transactional(readOnly = true)
    public RunPlan loadPlan(UUID runId) {
        TestRun run = runs.findById(runId).orElseThrow();
        Project project = projects.findById(run.getProjectId()).orElseThrow();
        List<ScenarioRun> srs = scenarioRuns.findByRunIdOrderByOrdAsc(runId);
        Map<UUID, Scenario> scenarioById = scenarios.findAllById(srs.stream().map(ScenarioRun::getScenarioId).toList())
                .stream().collect(Collectors.toMap(Scenario::getId, Function.identity()));
        List<CaseResult> crs = caseResults.findByScenarioRunIdIn(srs.stream().map(ScenarioRun::getId).toList());
        Map<UUID, TestCase> caseById = testCases.findAllById(crs.stream().map(CaseResult::getTestCaseId).toList())
                .stream().collect(Collectors.toMap(TestCase::getId, Function.identity()));
        List<ScenarioPlan> plans = new ArrayList<>();
        for (ScenarioRun sr : srs) {
            Scenario s = scenarioById.get(sr.getScenarioId());
            List<CasePlan> cases = new ArrayList<>();
            ScenarioPlan plan = new ScenarioPlan(sr.getId(), s.getCode(), s.getTitle(), s.getRequirementRef(), cases);
            crs.stream().filter(cr -> cr.getScenarioRunId().equals(sr.getId()))
                    .sorted(Comparator.comparingInt(cr -> caseById.get(cr.getTestCaseId()).getOrd()))
                    .forEach(cr -> {
                        TestCase tc = caseById.get(cr.getTestCaseId());
                        cases.add(new CasePlan(cr.getId(), tc.getId(), tc.getCode(), tc.getVersion(),
                                new GeneratedCase(tc.getCode(), tc.getTitle(), tc.getType(), tc.getScopes(),
                                        tc.getPreconditions(), tc.getSteps(), tc.getExpectedResult(),
                                        tc.getExpectedValues()), plan));
                    });
            plans.add(plan);
        }
        return new RunPlan(runId, run.code(), project.getId(), run.getTargetUrl(), project.getTestControlUrl(),
                project.getQueryApiBaseUrl(), run.getViewportWidth(), run.getViewportHeight(), plans);
    }

    @Transactional(readOnly = true)
    public RunStatus status(UUID runId) {
        return runs.findById(runId).map(TestRun::getStatus).orElse(RunStatus.CANCELLED);
    }

    public void transitionRun(UUID runId, RunStatus next, String errorMessage) {
        TestRun run = runs.findByIdForUpdate(runId).orElseThrow();
        run.transitionTo(next);
        if (errorMessage != null) {
            run.fail(errorMessage);
        }
    }

    /** CANCELLING 이면 CANCELLED, 진행 중이면 target(ERROR 등)으로 끝낸다. 이미 끝났으면 그대로. */
    public RunStatus finishRun(UUID runId, RunStatus target, String errorMessage) {
        TestRun run = runs.findByIdForUpdate(runId).orElseThrow();
        if (run.getStatus().isTerminal()) {
            return run.getStatus();
        }
        RunStatus next = run.getStatus() == RunStatus.CANCELLING ? RunStatus.CANCELLED : target;
        if (run.getStatus() == RunStatus.PREPARING && (next == RunStatus.PASSED || next == RunStatus.FAILED)) {
            run.transitionTo(RunStatus.RUNNING);
        }
        run.transitionTo(next);
        if (errorMessage != null && next == RunStatus.ERROR) {
            run.fail(errorMessage);
        }
        return next;
    }

    public void recordBuild(UUID runId, String build) {
        runs.findById(runId).ifPresent(r -> r.recordBuild(build));
    }

    public void recordBrowser(UUID runId, String browser) {
        runs.findById(runId).ifPresent(r -> r.recordBrowser(browser));
    }

    public void startScenario(UUID scenarioRunId) {
        scenarioRuns.findById(scenarioRunId).orElseThrow().transitionTo(ScenarioRunStatus.RUNNING);
    }

    public void finishScenario(UUID scenarioRunId, ScenarioRunStatus status, long durationMs) {
        ScenarioRun sr = scenarioRuns.findById(scenarioRunId).orElseThrow();
        if (sr.getStatus() == ScenarioRunStatus.WAITING) {
            sr.transitionTo(status);
        } else if (!sr.getStatus().isTerminal()) {
            sr.finish(status, durationMs);
        }
    }

    @Transactional(readOnly = true)
    public ScenarioRun scenarioRun(UUID scenarioRunId) {
        return scenarioRuns.findById(scenarioRunId).orElseThrow();
    }

    @Transactional(readOnly = true)
    public ScenarioRunStatus scenarioStatus(UUID scenarioRunId) {
        return scenarioRuns.findById(scenarioRunId).map(ScenarioRun::getStatus).orElseThrow();
    }

    @Transactional(readOnly = true)
    public List<CaseResultStatus> caseStatuses(UUID scenarioRunId) {
        return caseResults.findByScenarioRunId(scenarioRunId).stream().map(CaseResult::getStatus).toList();
    }

    @Transactional(readOnly = true)
    public List<CaseResultStatus> allCaseStatuses(UUID runId) {
        List<UUID> ids = scenarioRuns.findByRunIdOrderByOrdAsc(runId).stream().map(ScenarioRun::getId).toList();
        return ids.isEmpty() ? List.of() : caseResults.findByScenarioRunIdIn(ids).stream().map(CaseResult::getStatus).toList();
    }

    /** 시작하지 않은 시나리오·케이스를 SKIPPED 또는 CANCELLED 로 닫는다 (state-machines.md Run). */
    public List<UUID> closeRemaining(UUID runId, boolean cancelled) {
        List<UUID> closed = new ArrayList<>();
        for (ScenarioRun sr : scenarioRuns.findByRunIdOrderByOrdAsc(runId)) {
            for (CaseResult cr : caseResults.findByScenarioRunId(sr.getId())) {
                if (cr.getStatus() == CaseResultStatus.PENDING) {
                    cr.transitionTo(cancelled ? CaseResultStatus.CANCELLED : CaseResultStatus.SKIPPED);
                } else if (cr.getStatus() == CaseResultStatus.RUNNING) {
                    cr.finish(cancelled ? CaseResultStatus.CANCELLED : CaseResultStatus.ERROR,
                            cancelled ? cr.getFailureType() : FailureType.ENVIRONMENT_ERROR,
                            cancelled ? cr.getFailureMessage() : "실행이 중단되었습니다", 0);
                }
            }
            if (sr.getStatus() == ScenarioRunStatus.WAITING) {
                sr.transitionTo(cancelled ? ScenarioRunStatus.CANCELLED : ScenarioRunStatus.SKIPPED);
                closed.add(sr.getId());
            } else if (sr.getStatus() == ScenarioRunStatus.RUNNING) {
                sr.finish(cancelled ? ScenarioRunStatus.CANCELLED : ScenarioRunStatus.ERROR, 0);
                closed.add(sr.getId());
            }
        }
        return closed;
    }

    public void startCase(UUID caseResultId) {
        caseResults.findById(caseResultId).orElseThrow().transitionTo(CaseResultStatus.RUNNING);
    }

    public CaseResult recordAttempt(UUID caseResultId, boolean failed) {
        CaseResult cr = caseResults.findById(caseResultId).orElseThrow();
        cr.recordAttempt(failed);
        return cr;
    }

    public void finishCase(UUID caseResultId, CaseResultStatus status, FailureType type, String message, long duration) {
        caseResults.findById(caseResultId).orElseThrow().finish(status, type, message, duration);
    }

    public void closeCase(UUID caseResultId, CaseResultStatus status) {
        CaseResult cr = caseResults.findById(caseResultId).orElseThrow();
        if (cr.getStatus() == CaseResultStatus.PENDING) {
            cr.transitionTo(status);
        }
    }

    @Transactional(readOnly = true)
    public CaseResult caseResult(UUID caseResultId) {
        return caseResults.findById(caseResultId).orElseThrow();
    }

    public void markPreparationFailure(UUID caseResultId, String message) {
        caseResults.findById(caseResultId).orElseThrow().markPreparationFailure(FailureType.TEST_CODE_ERROR, message);
    }

    /** 준비된 spec 을 쓰지 않기로 함 (계약 위반 TestQuery). 실행 때 RUNNING → ERROR(TEST_CODE_ERROR). */
    public void rejectPreparedSpec(UUID caseResultId, String message) {
        CaseResult cr = caseResults.findById(caseResultId).orElseThrow();
        cr.useSpec(null);
        cr.markPreparationFailure(FailureType.TEST_CODE_ERROR, message);
    }

    public void useSpec(UUID caseResultId, UUID specId) {
        caseResults.findById(caseResultId).orElseThrow().useSpec(specId);
    }

    /**
     * 같은 케이스 version 의 컴파일 통과 spec 중 가장 최근 것. TestQuery 를 다시 쓰기 위한 후보이며,
     * 실행 전에 실행기로 다시 렌더링해 렌더러 버전이 바뀌었으면 새 spec 으로 저장한다 (generated_spec = 실제 실행 코드).
     */
    @Transactional(readOnly = true)
    public Optional<GeneratedSpec> reusableSpec(UUID testCaseId, int version) {
        return specs.findByTestCaseIdAndTestCaseVersionOrderByCreatedAtDesc(testCaseId, version).stream()
                .filter(s -> s.getCompileStatus() == CompileStatus.PASSED)
                .findFirst();
    }

    @Transactional(readOnly = true)
    public GeneratedSpec spec(UUID specId) {
        return specs.findById(specId).orElseThrow();
    }

    public GeneratedSpec saveSpec(UUID testCaseId, int version, Map<String, Object> testQuery, String source,
                                  String rendererVersion, CompileStatus status, String error) {
        Optional<GeneratedSpec> existing = specs.findByTestCaseIdAndTestCaseVersionAndRendererVersion(testCaseId,
                version, rendererVersion);
        if (existing.isPresent()) {
            existing.get().replace(testQuery, source, rendererVersion, status, error);
            return existing.get();
        }
        return specs.save(new GeneratedSpec(testCaseId, version, testQuery, source, rendererVersion, status, error));
    }

    public record StepDef(StepKind kind, String title) {
    }

    public List<RunStep> createSteps(UUID caseResultId, int attempt, List<StepDef> defs) {
        List<RunStep> created = new ArrayList<>();
        for (int i = 0; i < defs.size(); i++) {
            created.add(steps.save(new RunStep(caseResultId, attempt, i + 1, defs.get(i).kind(), defs.get(i).title())));
        }
        steps.flush();
        return created;
    }

    public RunStep updateStep(UUID stepId, StepStatus status, String detail, String expected, String actual,
                              SchemaCheckStatus schemaCheck) {
        RunStep step = steps.findById(stepId).orElseThrow();
        step.update(status, detail, expected, actual);
        if (schemaCheck != null) {
            step.recordSchemaCheck(schemaCheck);
        }
        return step;
    }

    /** 아직 PENDING·RUNNING 인 단계를 SKIPPED 로 닫는다. 닫은 단계를 돌려준다. */
    public List<RunStep> skipOpenSteps(UUID caseResultId, int attempt) {
        List<RunStep> closed = new ArrayList<>();
        for (RunStep step : steps.findByCaseResultIdAndAttemptOrderByOrdAsc(caseResultId, attempt)) {
            if (step.getStatus() == StepStatus.PENDING || step.getStatus() == StepStatus.RUNNING) {
                step.update(StepStatus.SKIPPED, null, null, null);
                closed.add(step);
            }
        }
        return closed;
    }

    public ApiCallEntry saveApiCall(UUID runId, UUID caseResultId, String method, String path, Integer statusCode,
                                    Integer durationMs, Instant occurredAt) {
        return apiCalls.save(new ApiCallEntry(runId, caseResultId, method, path, statusCode, durationMs, occurredAt));
    }

    public Artifact saveArtifact(UUID runId, UUID caseResultId, ArtifactType type, String key, byte[] content,
                                 String contentType, String label) {
        storage.put(key, content, contentType);
        return artifacts.save(new Artifact(runId, caseResultId, type, key, contentType, content.length, label));
    }

    public void replaceVerifications(UUID caseResultId, List<Verification> rows) {
        verifications.deleteByCaseResultId(caseResultId);
        verifications.flush();
        verifications.saveAll(rows);
    }

    /** 활성 TEST_DATA 의 variables·secrets. 없으면 빈 값. */
    @Transactional(readOnly = true)
    public TestData testData(UUID projectId) {
        Optional<Document> doc = documents.findByProjectIdAndTypeAndActiveTrue(projectId, DocumentType.TEST_DATA);
        if (doc.isEmpty()) {
            return new TestData(Map.of(), Map.of());
        }
        try {
            JsonNode root = objectMapper.readTree(storage.read(doc.get().getStorageKey()));
            return new TestData(strings(root.get("variables")), strings(root.get("secrets")));
        } catch (IOException | RuntimeException ex) {
            return new TestData(Map.of(), Map.of());
        }
    }

    private static Map<String, String> strings(JsonNode node) {
        Map<String, String> out = new LinkedHashMap<>();
        if (node != null && node.isObject()) {
            node.fields().forEachRemaining(e -> out.put(e.getKey(), e.getValue().isTextual()
                    ? e.getValue().asText() : e.getValue().toString()));
        }
        return out;
    }
}
