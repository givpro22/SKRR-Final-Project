package com.skrr.platform.run;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;
import com.skrr.platform.client.ai.AiClient;
import com.skrr.platform.client.ai.AiJob;
import com.skrr.platform.client.ai.AiJobNotFoundException;
import com.skrr.platform.client.ai.AiRequestRejectedException;
import com.skrr.platform.client.ai.AiUnavailableException;
import com.skrr.platform.client.ai.TestQueryGenerationRequest;
import com.skrr.platform.client.ai.TestQueryGenerationResult;
import com.skrr.platform.client.runner.RunnerClient;
import com.skrr.platform.client.runner.RunnerDtos.ArtifactFile;
import com.skrr.platform.client.runner.RunnerDtos.ArtifactRef;
import com.skrr.platform.client.runner.RunnerDtos.Execution;
import com.skrr.platform.client.runner.RunnerDtos.ExecutionEvent;
import com.skrr.platform.client.runner.RunnerDtos.ExecutionRequest;
import com.skrr.platform.client.runner.RunnerDtos.RenderResult;
import com.skrr.platform.client.runner.RunnerDtos.StepResult;
import com.skrr.platform.client.runner.RunnerDtos.Viewport;
import com.skrr.platform.client.runner.RunnerRequestRejectedException;
import com.skrr.platform.client.runner.RunnerUnavailableException;
import com.skrr.platform.client.target.TargetSiteClient;
import com.skrr.platform.common.config.SkrrProperties;
import com.skrr.platform.common.time.Times;
import com.skrr.platform.run.CrossCheckEvaluator.Normalize;
import com.skrr.platform.run.RunEnums.ArtifactType;
import com.skrr.platform.run.RunEnums.CompileStatus;
import com.skrr.platform.run.RunEnums.FailureType;
import com.skrr.platform.run.RunEnums.RunEventType;
import com.skrr.platform.run.RunEnums.SchemaCheckStatus;
import com.skrr.platform.run.RunEnums.StepKind;
import com.skrr.platform.run.RunEnums.StepStatus;
import com.skrr.platform.run.RunEnums.Verdict;
import com.skrr.platform.run.RunStore.CasePlan;
import com.skrr.platform.run.RunStore.RunPlan;
import com.skrr.platform.run.RunStore.ScenarioPlan;
import com.skrr.platform.run.RunStore.StepDef;
import com.skrr.platform.run.RunStore.TestData;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * 실행 제어 (WBS 4.3.9, state-machines.md Run). 플랫폼 전체에서 한 번에 한 실행만 처리한다(U3).
 * <pre>
 * PREPARING: 케이스마다 TestQuery 생성(AI) → renderSpec(실행기) → generated_spec (최대 3회, 같은 version 재사용)
 * RUNNING:   케이스마다 초기화(SETUP) → DB 사전 조회 → 실행기 실행 → DB 사후 조회 → 교차 검증(ASSERT) → 정리(TEARDOWN)
 *            실패하면 최대 3회 다시 실행해 재현 횟수를 기록한다. 정리는 앞 단계가 실패해도 한다.
 * 끝:        state-machines.md 끝 상태 순서표로 정한다.
 * </pre>
 * 실행기·AI 장애는 ERROR, 테스트 실패는 FAILED 로 구분한다. 판정은 수집한 값으로만 계산한다.
 */
@Component
public class RunWorker {

    private static final Logger log = LoggerFactory.getLogger(RunWorker.class);
    private static final Set<String> FAILURE_TYPES = Set.of(
            "DATA_MISMATCH", "ASSERTION_FAILED", "ELEMENT_NOT_FOUND", "API_ERROR", "API_SCHEMA_MISMATCH", "TIMEOUT",
            "ENVIRONMENT_ERROR", "TEST_CODE_ERROR");

    private final RunStore store;
    private final RunEventPublisher events;
    private final RunQueryService queries;
    private final AiClient ai;
    private final RunnerClient runner;
    private final TargetSiteClient target;
    private final ObjectMapper objectMapper;
    private final SkrrProperties.Run settings;
    private final com.skrr.platform.report.RunFinalizer finalizer;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> thread(r, "run-worker"));
    private final ExecutorService streams = Executors.newCachedThreadPool(r -> thread(r, "run-events"));
    private final Map<UUID, UUID> currentExecution = new ConcurrentHashMap<>();

    public RunWorker(RunStore store, RunEventPublisher events, RunQueryService queries, AiClient ai,
                     RunnerClient runner, TargetSiteClient target, ObjectMapper objectMapper,
                     SkrrProperties properties, com.skrr.platform.report.RunFinalizer finalizer) {
        this.store = store;
        this.events = events;
        this.queries = queries;
        this.ai = ai;
        this.runner = runner;
        this.target = target;
        this.objectMapper = objectMapper;
        this.settings = properties.run();
        this.finalizer = finalizer;
    }

    private static Thread thread(Runnable r, String name) {
        Thread t = new Thread(r, name);
        t.setDaemon(true);
        return t;
    }

    @PreDestroy
    void shutdown() {
        worker.shutdownNow();
        streams.shutdownNow();
    }

    public void submit(UUID runId) {
        worker.submit(() -> execute(runId));
    }

    /** cancelRun 직후 부른다. 실행기에서 실행 중인 케이스가 있으면 바로 중단을 요청한다. */
    public void requestCancel(UUID runId) {
        UUID execution = currentExecution.get(runId);
        if (execution != null) {
            runner.cancelExecution(execution);
        }
    }

    /** 실행을 더 진행할 수 없음 (실행기·대상 사이트·AI 장애). 남은 케이스를 SKIPPED 로 두고 실행을 ERROR 로 끝낸다. */
    static final class RunAbort extends RuntimeException {
        RunAbort(String message) {
            super(message);
        }
    }

    // ------------------------------------------------------------------ 실행 전체

    void execute(UUID runId) {
        RunPlan plan;
        try {
            plan = store.loadPlan(runId);
        } catch (RuntimeException ex) {
            log.error("실행 계획을 읽지 못했습니다: {}", runId, ex);
            return;
        }
        try {
            publishRunStatus(runId);
            store.recordBuild(runId, safeBuild(plan.testControlUrl()));
            TestData data = store.testData(plan.projectId());
            prepare(plan, data);
            if (cancelRequested(runId)) {
                finishCancelled(plan);
                return;
            }
            store.transitionRun(runId, RunStatus.RUNNING, null);
            publishRunStatus(runId);
            for (ScenarioPlan scenario : plan.scenarios()) {
                if (cancelRequested(runId)) {
                    break;
                }
                runScenario(plan, scenario, data);
            }
            if (cancelRequested(runId)) {
                finishCancelled(plan);
                return;
            }
            List<CaseResultStatus> statuses = store.allCaseStatuses(runId);
            RunStatus end = statuses.contains(CaseResultStatus.FAILED) ? RunStatus.FAILED
                    : statuses.contains(CaseResultStatus.ERROR) ? RunStatus.ERROR : RunStatus.PASSED;
            // 분석 요청을 먼저 만든 뒤 끝 상태로 바꾼다 (끝난 실행을 보는 쪽이 분석 상태를 PENDING 으로 보게)
            finalizeRun(plan);
            store.finishRun(runId, end, end == RunStatus.ERROR ? "환경 문제로 판정하지 못한 케이스가 있습니다" : null);
            publishRunStatus(runId);
        } catch (RunAbort abort) {
            abort(plan, abort.getMessage());
        } catch (RuntimeException ex) {
            log.error("실행 중 처리하지 못한 오류: {}", runId, ex);
            abort(plan, "실행 중 오류가 발생했습니다: " + ex.getMessage());
        } finally {
            currentExecution.remove(runId);
        }
    }

    private String safeBuild(String testControlUrl) {
        try {
            return target.build(testControlUrl);
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private void abort(RunPlan plan, String message) {
        UUID runId = plan.runId();
        log.warn("실행 {} 중단: {}", plan.runCode(), message);
        log(runId, StepKind.SETUP, "실행 중단: " + message, null);
        boolean cancelled = cancelRequested(runId);
        List<UUID> closed = store.closeRemaining(runId, cancelled);
        closed.forEach(id -> publishScenarioStatus(plan, id));
        finalizeRun(plan);
        store.finishRun(runId, RunStatus.ERROR, message);
        publishRunStatus(runId);
    }

    private void finishCancelled(RunPlan plan) {
        List<UUID> closed = store.closeRemaining(plan.runId(), true);
        closed.forEach(id -> publishScenarioStatus(plan, id));
        finalizeRun(plan);
        store.finishRun(plan.runId(), RunStatus.CANCELLED, null);
        log(plan.runId(), StepKind.SETUP, "사용자가 실행을 중단했습니다", null);
        publishRunStatus(plan.runId());
    }

    /** 실패 지문·처음 발생 계산과 실패 원인 분석 작업 생성 (M4). 실행 끝 상태에는 영향을 주지 않는다. */
    private void finalizeRun(RunPlan plan) {
        try {
            int analyses = finalizer.finish(plan.runId());
            if (analyses > 0) {
                log(plan.runId(), StepKind.ASSERT, "실패 케이스 " + analyses + "건의 원인 분석을 시작했습니다", null);
            }
        } catch (RuntimeException ex) {
            log.error("실행 마무리(분석 요청) 실패: {}", plan.runCode(), ex);
        }
    }

    private boolean cancelRequested(UUID runId) {
        RunStatus status = store.status(runId);
        return status == RunStatus.CANCELLING || status == RunStatus.CANCELLED;
    }

    // ------------------------------------------------------------------ PREPARING

    private void prepare(RunPlan plan, TestData data) {
        for (CasePlan c : plan.allCases()) {
            if (cancelRequested(plan.runId())) {
                return;
            }
            Optional<GeneratedSpec> reusable = store.reusableSpec(c.testCaseId(), c.version())
                    .filter(spec -> missingReferences(spec.getTestQuery(), data).isEmpty());
            if (reusable.isEmpty()) {
                generate(plan, c, data, 1, null);
            } else {
                String reuseFailure = reuse(plan, c, reusable.get());
                if (reuseFailure != null) {
                    // 저장된 TestQuery 의 변환 실패도 3회 규칙의 1회로 센다 (state-machines.md Run)
                    generate(plan, c, data, 2, reuseFailure);
                }
            }
            rejectOutsideQueryApi(plan, c);
        }
    }

    /**
     * 저장된 TestQuery 를 다시 쓴다(AI 호출 없음). 실행기가 실제로 실행하는 코드와 같도록 매번 renderSpec 으로 다시 변환하고,
     * 렌더러 버전이 바뀌었으면 그 버전의 spec 을 새로 저장한다. 변환이 실패하면 그 사유(새로 생성), 성공하면 null.
     */
    private String reuse(RunPlan plan, CasePlan c, GeneratedSpec saved) {
        RenderResult render;
        try {
            render = runner.renderSpec(saved.getTestQuery());
        } catch (RunnerUnavailableException ex) {
            throw new RunAbort("실행기에 연결할 수 없어 spec 을 변환하지 못했습니다");
        } catch (RunnerRequestRejectedException ex) {
            return "TestQuery 스키마 위반: " + ex.getMessage();
        }
        if (!"PASSED".equals(render.compileStatus())) {
            return "spec 문법 검사 실패: " + (render.compileErrors() == null ? "" : String.join("\n", render.compileErrors()));
        }
        String rendererVersion = render.rendererVersion() == null ? "unknown" : render.rendererVersion();
        GeneratedSpec spec = rendererVersion.equals(saved.getRendererVersion()) ? saved
                : store.saveSpec(c.testCaseId(), c.version(), saved.getTestQuery(),
                        render.specSource() == null ? "" : render.specSource(), rendererVersion, CompileStatus.PASSED,
                        null);
        store.useSpec(c.caseResultId(), spec.getId());
        log(plan.runId(), StepKind.SETUP, c.code() + " 저장된 TestQuery 재사용 (v" + c.version() + ", 렌더러 "
                + rendererVersion + ")", c.caseResultId());
        return null;
    }

    /**
     * dbChecks.path 가 읽기 전용 조회 API(queryApiBaseUrl 경로) 밖이면 실행하지 않고 그 케이스를 ERROR 로 둔다.
     * 조회 API 밖을 부르지 않기 위해서다 (state-machines.md Run).
     */
    @SuppressWarnings("unchecked")
    private void rejectOutsideQueryApi(RunPlan plan, CasePlan c) {
        CaseResult cr = store.caseResult(c.caseResultId());
        if (cr.getGeneratedSpecId() == null || plan.queryApiBaseUrl() == null || plan.queryApiBaseUrl().isBlank()) {
            return;
        }
        Map<String, Object> testQuery = store.spec(cr.getGeneratedSpecId()).getTestQuery();
        List<String> outside = ((List<Map<String, Object>>) testQuery.getOrDefault("dbChecks", List.of())).stream()
                .map(check -> String.valueOf(check.get("path")))
                .filter(path -> !TargetSiteClient.isUnderQueryApi(plan.queryApiBaseUrl(), path))
                .toList();
        if (!outside.isEmpty()) {
            String message = "DB 확인 경로가 읽기 전용 조회 API(" + plan.queryApiBaseUrl() + ") 밖이라 실행하지 않았습니다: "
                    + String.join(", ", outside);
            store.rejectPreparedSpec(c.caseResultId(), message);
            log(plan.runId(), StepKind.SETUP, c.code() + " " + message, c.caseResultId());
        }
    }

    /** TestQuery 생성 → spec 변환을 최대 3회 시도한다. 모두 실패하면 그 케이스만 TEST_CODE_ERROR. */
    private void generate(RunPlan plan, CasePlan c, TestData data, int firstAttempt, String initialError) {
        String previousError = initialError;
        int max = settings.maxGenerationAttempts();
        for (int attempt = firstAttempt; attempt <= max; attempt++) {
            log(plan.runId(), StepKind.SETUP, c.code() + " TestQuery 생성 (" + attempt + "/" + max + ")", c.caseResultId());
            TestQueryGenerationRequest request = new TestQueryGenerationRequest(plan.projectId(),
                    new TestQueryGenerationRequest.Scenario(c.scenario().code(), c.scenario().title(),
                            c.scenario().requirementRef()), c.content(), data.names(), previousError,
                    plan.queryApiBaseUrl() == null || plan.queryApiBaseUrl().isBlank() ? null : plan.queryApiBaseUrl());
            Map<String, Object> testQuery;
            try {
                TestQueryGenerationResult result = generateTestQuery(request);
                if (result.guard() != null && Boolean.FALSE.equals(result.guard().passed())) {
                    // AI 가드가 이미 최대 3회 재생성한 결과다. 다시 요청하지 않고 이 케이스를 ERROR 로 둔다
                    previousError = "TestQuery 가드 실패 (" + result.guard().attempts() + "회): " + guardMessages(result);
                    break;
                }
                testQuery = result.testQuery();
                if (testQuery == null) {
                    previousError = "TestQuery 가 비어 있습니다";
                    continue;
                }
            } catch (GenerationFailure ex) {
                previousError = ex.getMessage();
                if (!ex.retryable) {
                    break;
                }
                continue;
            }
            testQuery = new LinkedHashMap<>(testQuery);
            testQuery.remove("variables");
            List<String> missing = missingReferences(testQuery, data);
            if (!missing.isEmpty()) {
                previousError = "TEST_DATA 에 없는 이름을 참조합니다: " + String.join(", ", missing);
                continue;
            }
            RenderResult render;
            try {
                render = runner.renderSpec(testQuery);
            } catch (RunnerUnavailableException ex) {
                throw new RunAbort("실행기에 연결할 수 없어 spec 을 변환하지 못했습니다");
            } catch (RunnerRequestRejectedException ex) {
                previousError = "TestQuery 스키마 위반: " + ex.getMessage();
                continue;
            }
            boolean passed = "PASSED".equals(render.compileStatus());
            String compileError = render.compileErrors() == null || render.compileErrors().isEmpty() ? null
                    : String.join("\n", render.compileErrors());
            GeneratedSpec spec = store.saveSpec(c.testCaseId(), c.version(), testQuery,
                    render.specSource() == null ? "" : render.specSource(),
                    render.rendererVersion() == null ? "unknown" : render.rendererVersion(),
                    passed ? CompileStatus.PASSED : CompileStatus.FAILED, compileError);
            if (passed) {
                store.useSpec(c.caseResultId(), spec.getId());
                log(plan.runId(), StepKind.SETUP, c.code() + " spec 준비 완료 (" + RunQueryService.specFileName(c.code())
                        + ")", c.caseResultId());
                return;
            }
            previousError = "spec 문법 검사 실패: " + compileError;
        }
        String message = "TestQuery 를 만들지 못했습니다: " + previousError;
        store.markPreparationFailure(c.caseResultId(), message);
        log(plan.runId(), StepKind.SETUP, c.code() + " " + message, c.caseResultId());
    }

    /** 생성 1회 실패. retryable 이면 사유를 다음 시도에 넘기고, 아니면 그 케이스를 바로 ERROR 로 둔다. */
    static final class GenerationFailure extends RuntimeException {
        final boolean retryable;

        GenerationFailure(String message) {
            this(message, true);
        }

        GenerationFailure(String message, boolean retryable) {
            super(message);
            this.retryable = retryable;
        }
    }

    private TestQueryGenerationResult generateTestQuery(TestQueryGenerationRequest request) {
        boolean resubmitted = false;
        AiJob job = startGeneration(request);
        Instant deadline = Instant.now().plus(settings.aiJobTimeout());
        while (true) {
            sleep(settings.aiPollInterval());
            AiJob current;
            try {
                current = ai.getJob(job.jobId());
            } catch (AiJobNotFoundException ex) {
                if (resubmitted) {
                    throw new GenerationFailure("AI 서버에서 작업을 잃었습니다");
                }
                resubmitted = true;
                job = startGeneration(request);
                continue;
            } catch (AiUnavailableException ex) {
                throw new RunAbort("AI 서버에 연결할 수 없어 실행을 준비하지 못했습니다");
            } catch (AiRequestRejectedException ex) {
                throw new GenerationFailure("AI 작업 조회 거부: " + ex.getMessage());
            }
            switch (current.status()) {
                case "SUCCEEDED" -> {
                    try {
                        TestQueryGenerationResult result = objectMapper.treeToValue(current.result(),
                                TestQueryGenerationResult.class);
                        if (result == null || !"TEST_QUERY_GENERATE".equals(result.kind())) {
                            throw new GenerationFailure("AI TestQuery 결과 형식이 계약과 다릅니다");
                        }
                        return result;
                    } catch (com.fasterxml.jackson.core.JsonProcessingException | IllegalArgumentException ex) {
                        throw new GenerationFailure("AI TestQuery 결과 형식이 계약과 다릅니다: " + ex.getMessage());
                    }
                }
                case "FAILED", "CANCELLED" -> {
                    AiJob.Error error = current.error();
                    throw new GenerationFailure(error == null ? "AI TestQuery 생성 실패"
                            : "AI TestQuery 생성 실패 (" + error.code() + "): " + error.message(),
                            error != null && Boolean.TRUE.equals(error.retryable()));
                }
                default -> {
                    if (Instant.now().isAfter(deadline)) {
                        throw new GenerationFailure("AI TestQuery 생성 시간 초과");
                    }
                }
            }
        }
    }

    private AiJob startGeneration(TestQueryGenerationRequest request) {
        try {
            return ai.startTestQueryGeneration(request);
        } catch (AiUnavailableException ex) {
            throw new RunAbort("AI 서버에 연결할 수 없어 실행을 준비하지 못했습니다");
        } catch (AiRequestRejectedException ex) {
            throw new GenerationFailure("AI 가 TestQuery 생성 요청을 거부했습니다: " + ex.getMessage(), false);
        }
    }

    private static String guardMessages(TestQueryGenerationResult result) {
        if (result.guard().failures() == null || result.guard().failures().isEmpty()) {
            return "사유 없음";
        }
        return String.join("; ", result.guard().failures().stream().map(f -> f.kind() + " " + f.message()).toList());
    }

    /** TestQuery 가 참조하는 {{이름}} 중 TEST_DATA 와 캡처 어디에도 없는 이름 (A16). */
    List<String> missingReferences(Map<String, Object> testQuery, TestData data) {
        JsonNode root = objectMapper.valueToTree(testQuery);
        Set<String> captures = new HashSet<>();
        Set<String> referenced = new HashSet<>();
        collect(root, captures, referenced);
        List<String> missing = new ArrayList<>();
        for (String name : referenced) {
            if (!data.variables().containsKey(name) && !data.secrets().containsKey(name) && !captures.contains(name)) {
                missing.add(name);
            }
        }
        missing.sort(String::compareTo);
        return missing;
    }

    private static void collect(JsonNode node, Set<String> captures, Set<String> referenced) {
        if (node == null) {
            return;
        }
        if (node.isTextual()) {
            referenced.addAll(TemplateValues.references(node.asText()));
        } else if (node.isObject()) {
            if (node.hasNonNull("as") && node.get("as").isTextual()) {
                captures.add(node.get("as").asText());
            }
            if (node.has("captures") && node.get("captures").isObject()) {
                node.get("captures").fieldNames().forEachRemaining(captures::add);
            }
            node.fields().forEachRemaining(e -> {
                if (!"variables".equals(e.getKey())) {
                    collect(e.getValue(), captures, referenced);
                }
            });
        } else if (node.isArray()) {
            node.forEach(child -> collect(child, captures, referenced));
        }
    }

    // ------------------------------------------------------------------ RUNNING

    private void runScenario(RunPlan plan, ScenarioPlan scenario, TestData data) {
        UUID runId = plan.runId();
        if (scenario.cases().isEmpty()) {
            store.finishScenario(scenario.scenarioRunId(), ScenarioRunStatus.SKIPPED, 0);
            publishScenarioStatus(plan, scenario.scenarioRunId());
            return;
        }
        long started = System.currentTimeMillis();
        store.startScenario(scenario.scenarioRunId());
        publishScenarioStatus(plan, scenario.scenarioRunId());
        boolean cancelled = false;
        for (CasePlan c : scenario.cases()) {
            if (cancelRequested(runId)) {
                cancelled = true;
                store.closeCase(c.caseResultId(), CaseResultStatus.CANCELLED);
                publishCaseStatus(runId, c);
                continue;
            }
            runCase(plan, c, data);
        }
        List<CaseResultStatus> statuses = store.caseStatuses(scenario.scenarioRunId());
        ScenarioRunStatus end = cancelled || statuses.contains(CaseResultStatus.CANCELLED) ? ScenarioRunStatus.CANCELLED
                : statuses.contains(CaseResultStatus.FAILED) ? ScenarioRunStatus.FAILED
                : statuses.contains(CaseResultStatus.ERROR) ? ScenarioRunStatus.ERROR : ScenarioRunStatus.PASSED;
        store.finishScenario(scenario.scenarioRunId(), end, System.currentTimeMillis() - started);
        publishScenarioStatus(plan, scenario.scenarioRunId());
    }

    /** 시도 1회의 결과. */
    record Outcome(CaseResultStatus status, FailureType failureType, String message) {
        static Outcome passed() {
            return new Outcome(CaseResultStatus.PASSED, null, null);
        }
    }

    private void runCase(RunPlan plan, CasePlan c, TestData data) {
        UUID runId = plan.runId();
        long started = System.currentTimeMillis();
        store.startCase(c.caseResultId());
        publishCaseStatus(runId, c);
        CaseResult cr = store.caseResult(c.caseResultId());
        if (cr.getGeneratedSpecId() == null) {
            String message = cr.getFailureMessage() == null ? "TestQuery 를 만들지 못했습니다" : cr.getFailureMessage();
            store.finishCase(c.caseResultId(), CaseResultStatus.ERROR, FailureType.TEST_CODE_ERROR, message, 0);
            publishCaseStatus(runId, c);
            return;
        }
        Map<String, Object> testQuery = store.spec(cr.getGeneratedSpecId()).getTestQuery();
        Outcome firstFailure = null;
        Outcome last = null;
        boolean anyError = false;
        Outcome errorOutcome = null;
        for (int attempt = 1; attempt <= settings.maxAttempts(); attempt++) {
            if (attempt > 1 && cancelRequested(runId)) {
                break;
            }
            if (attempt > 1) {
                log(runId, StepKind.SETUP, c.code() + " 실패 재현 시도 " + attempt + "/" + settings.maxAttempts(),
                        c.caseResultId());
            }
            Outcome outcome = runAttempt(plan, c, attempt, testQuery, data);
            last = outcome;
            boolean failed = outcome.status() == CaseResultStatus.FAILED;
            store.recordAttempt(c.caseResultId(), failed);
            publishCaseStatus(runId, c);
            if (failed && firstFailure == null) {
                firstFailure = outcome;
            }
            if (outcome.status() == CaseResultStatus.ERROR) {
                anyError = true;
                errorOutcome = outcome;
                break;
            }
            if (outcome.status() == CaseResultStatus.CANCELLED) {
                break;
            }
            if (attempt == 1 && outcome.status() == CaseResultStatus.PASSED) {
                break;
            }
        }
        Outcome finalOutcome;
        if (firstFailure != null) {
            finalOutcome = firstFailure;
        } else if (anyError) {
            finalOutcome = errorOutcome;
        } else if (last != null && last.status() == CaseResultStatus.CANCELLED || last == null) {
            finalOutcome = new Outcome(CaseResultStatus.CANCELLED, null, null);
        } else {
            finalOutcome = Outcome.passed();
        }
        store.finishCase(c.caseResultId(), finalOutcome.status(), finalOutcome.failureType(), finalOutcome.message(),
                System.currentTimeMillis() - started);
        publishCaseStatus(runId, c);
    }

    @SuppressWarnings("unchecked")
    private Outcome runAttempt(RunPlan plan, CasePlan c, int attempt, Map<String, Object> testQuery, TestData data) {
        UUID runId = plan.runId();
        UUID caseId = c.caseResultId();
        List<Map<String, Object>> tqSteps = (List<Map<String, Object>>) testQuery.getOrDefault("steps", List.of());
        List<Map<String, Object>> dbChecks = (List<Map<String, Object>>) testQuery.getOrDefault("dbChecks", List.of());
        List<Map<String, Object>> crossChecks = (List<Map<String, Object>>) testQuery.getOrDefault("crossChecks",
                List.of());
        List<Map<String, Object>> before = dbChecks.stream().filter(d -> "BEFORE".equals(d.get("phase"))).toList();
        List<Map<String, Object>> after = dbChecks.stream().filter(d -> "AFTER".equals(d.get("phase"))).toList();

        List<StepDef> defs = new ArrayList<>();
        defs.add(new StepDef(StepKind.SETUP, "데이터 초기화"));
        if (!before.isEmpty()) {
            defs.add(new StepDef(StepKind.DB, "DB 사전 조회 (" + before.size() + "건)"));
        }
        int runnerOffset = defs.size();
        for (Map<String, Object> s : tqSteps) {
            String action = String.valueOf(s.get("action"));
            StepKind kind = "apiRequest".equals(action) || "waitForApi".equals(action) ? StepKind.API : StepKind.UI;
            defs.add(new StepDef(kind, String.valueOf(s.getOrDefault("description", action))));
        }
        if (!after.isEmpty()) {
            defs.add(new StepDef(StepKind.DB, "DB 사후 조회 (" + after.size() + "건)"));
        }
        if (!crossChecks.isEmpty()) {
            defs.add(new StepDef(StepKind.ASSERT, "교차 검증 (" + crossChecks.size() + "건)"));
        }
        defs.add(new StepDef(StepKind.TEARDOWN, "데이터 정리"));
        List<RunStep> steps = store.createSteps(caseId, attempt, defs);
        steps.forEach(s -> publishStep(runId, caseId, s));
        int cursor = 0;

        Map<String, String> dbValues = new HashMap<>();
        Set<String> skippedDbChecks = new HashSet<>();
        Outcome outcome = null;
        try {
            // a. 데이터 초기화
            RunStep setup = steps.get(cursor++);
            outcome = resetTarget(plan, caseId, setup, "초기화");
            if (outcome != null) {
                return outcome;
            }
            // b. DB 사전 조회
            if (!before.isEmpty()) {
                outcome = queryDb(plan, caseId, steps.get(cursor++), before, data, dbValues, skippedDbChecks);
                if (outcome != null && outcome.status() == CaseResultStatus.ERROR) {
                    return outcome;
                }
            }
            if (cancelRequested(runId)) {
                return outcome = new Outcome(CaseResultStatus.CANCELLED, null, null);
            }
            // c. 실행기 실행
            Map<Integer, RunStep> runnerSteps = new HashMap<>();
            for (int i = 0; i < tqSteps.size(); i++) {
                runnerSteps.put(i + 1, steps.get(runnerOffset + i));
            }
            cursor = runnerOffset + tqSteps.size();
            RunnerResult runnerResult = execute(plan, c, attempt, testQuery, data, runnerSteps);
            if (!judgeable(runnerResult)) {
                // 실행기 장애·중단·요청 거부면 사후 조회와 교차 검증을 하지 않는다 (값이 없어 불일치로 보이지 않게)
                return outcome = verdict(runnerResult, null, false);
            }
            // d. DB 사후 조회
            Outcome dbOutcome = outcome;
            if (!after.isEmpty()) {
                Outcome afterOutcome = queryDb(plan, caseId, steps.get(cursor++), after, data, dbValues,
                        skippedDbChecks);
                if (afterOutcome != null) {
                    dbOutcome = dbOutcome == null || afterOutcome.status() == CaseResultStatus.ERROR ? afterOutcome
                            : dbOutcome;
                }
            }
            // e. 교차 검증
            boolean mismatch = false;
            if (!crossChecks.isEmpty()) {
                mismatch = crossCheck(runId, caseId, steps.get(cursor++), crossChecks, runnerResult.captures(), data,
                        dbValues, skippedDbChecks);
            }
            outcome = verdict(runnerResult, dbOutcome, mismatch);
            return outcome;
        } finally {
            // f. 데이터 정리 (앞 단계가 실패해도 한다)
            RunStep teardown = steps.get(steps.size() - 1);
            if (teardown.getStatus() == StepStatus.PENDING) {
                resetTarget(plan, caseId, teardown, "정리");
            }
            store.skipOpenSteps(caseId, attempt).forEach(s -> publishStep(runId, caseId, s));
            if (outcome != null && outcome.status() != CaseResultStatus.PASSED && outcome.message() != null) {
                log(runId, StepKind.ASSERT, c.code() + " " + attemptLabel(attempt) + outcome.status() + ": "
                        + outcome.message(), caseId);
            } else if (outcome != null) {
                log(runId, StepKind.ASSERT, c.code() + " " + attemptLabel(attempt) + outcome.status(), caseId);
            }
        }
    }

    /** 실행기가 테스트를 끝까지 판정했는지 (PASSED·FAILED). */
    private static boolean judgeable(RunnerResult runner) {
        return runner.outcome() == null && runner.execution() != null
                && ("PASSED".equals(runner.execution().status()) || "FAILED".equals(runner.execution().status()));
    }

    private static String attemptLabel(int attempt) {
        return attempt > 1 ? "(" + attempt + "회차) " : "";
    }

    private static Outcome verdict(RunnerResult runner, Outcome dbOutcome, boolean mismatch) {
        Execution e = runner.execution();
        if (runner.outcome() != null) {
            return runner.outcome();
        }
        String status = e.status();
        // 사용자 중단 요청 뒤 실행기가 브라우저를 닫아 ERROR 로 끝난 경우도 중단으로 본다 (끝 상태 순서표 1번)
        if ("CANCELLED".equals(status) || runner.cancelledByUser() && !"PASSED".equals(status)
                && !"FAILED".equals(status)) {
            return new Outcome(CaseResultStatus.CANCELLED, null, null);
        }
        if ("ERROR".equals(status)) {
            return new Outcome(CaseResultStatus.ERROR, failureType(e.failureType(), FailureType.ENVIRONMENT_ERROR),
                    clean(e.failureMessage()));
        }
        if ("FAILED".equals(status)) {
            return new Outcome(CaseResultStatus.FAILED, failureType(e.failureType(), FailureType.ASSERTION_FAILED),
                    clean(e.failureMessage()));
        }
        if (dbOutcome != null) {
            return dbOutcome;
        }
        if (mismatch) {
            return new Outcome(CaseResultStatus.FAILED, FailureType.DATA_MISMATCH, "화면·API·DB 교차 검증 불일치");
        }
        return Outcome.passed();
    }

    private static FailureType failureType(String value, FailureType fallback) {
        return value != null && FAILURE_TYPES.contains(value) ? FailureType.valueOf(value) : fallback;
    }

    /** 초기화·정리. 대상에 아예 접속할 수 없으면 실행 전체를 멈춘다. */
    private Outcome resetTarget(RunPlan plan, UUID caseId, RunStep step, String what) {
        UUID runId = plan.runId();
        StepKind kind = step.getKind();
        if (plan.testControlUrl() == null || plan.testControlUrl().isBlank()) {
            updateStep(runId, caseId, step, StepStatus.SKIPPED, "초기화 API(testControlUrl)가 없어 건너뜀", null, null, null);
            return null;
        }
        updateStep(runId, caseId, step, StepStatus.RUNNING, null, null, null, null);
        TargetSiteClient.Response response = target.reset(plan.testControlUrl());
        if (response.unreachable()) {
            updateStep(runId, caseId, step, StepStatus.FAILED, response.error(), null, null, null);
            if (kind == StepKind.TEARDOWN) {
                log(runId, kind, "데이터 정리 실패: " + response.error(), caseId);
                return null;
            }
            throw new RunAbort(response.error());
        }
        if (!response.ok()) {
            String detail = "데이터 " + what + " API 응답 " + response.status();
            updateStep(runId, caseId, step, StepStatus.FAILED, detail, null, null, null);
            log(runId, kind, detail, caseId);
            return kind == StepKind.TEARDOWN ? null
                    : new Outcome(CaseResultStatus.ERROR, FailureType.ENVIRONMENT_ERROR, detail);
        }
        updateStep(runId, caseId, step, StepStatus.PASSED, null, null, null, null);
        log(runId, kind, "데이터 " + what + " 완료", caseId);
        return null;
    }

    /** dbChecks 조회 (GET 만, X-Test-Control-Token). expected 가 있으면 비교한다. */
    private Outcome queryDb(RunPlan plan, UUID caseId, RunStep step, List<Map<String, Object>> checks, TestData data,
                            Map<String, String> dbValues, Set<String> skippedDbChecks) {
        UUID runId = plan.runId();
        if (plan.queryApiBaseUrl() == null || plan.queryApiBaseUrl().isBlank()) {
            // 설정이 없어 건너뜀: 교차 검증에서 이 출처를 뺀다 (값을 얻지 못한 것과 구분)
            checks.forEach(check -> skippedDbChecks.add(String.valueOf(check.get("id"))));
            updateStep(runId, caseId, step, StepStatus.SKIPPED, "읽기 전용 조회 API(queryApiBaseUrl)가 없어 건너뜀",
                    null, null, null);
            return null;
        }
        updateStep(runId, caseId, step, StepStatus.RUNNING, null, null, null, null);
        List<String> details = new ArrayList<>();
        Outcome failure = null;
        for (Map<String, Object> check : checks) {
            String id = String.valueOf(check.get("id"));
            String path = TemplateValues.fill(String.valueOf(check.get("path")), data.variables(), data.secrets(),
                    Map.of(), false);
            TargetSiteClient.Response response = target.query(plan.queryApiBaseUrl(), path);
            if (response.unreachable()) {
                updateStep(runId, caseId, step, StepStatus.FAILED, response.error(), null, null, null);
                throw new RunAbort("DB 조회 API: " + response.error());
            }
            if (!response.ok()) {
                String detail = check.get("label") + ": 조회 API 응답 " + response.status();
                updateStep(runId, caseId, step, StepStatus.FAILED, detail, null, null, null);
                return new Outcome(CaseResultStatus.ERROR, FailureType.ENVIRONMENT_ERROR, detail);
            }
            String value = extract(response.body(), String.valueOf(check.get("jsonPath")));
            dbValues.put(id, value);
            String expected = check.get("expected") == null ? null : TemplateValues.fill(
                    String.valueOf(check.get("expected")), data.variables(), data.secrets(), Map.of(), false);
            details.add(check.get("label") + " = " + value);
            log(runId, StepKind.DB, check.get("label") + " = " + value, caseId);
            if (expected != null && !expected.equals(value) && failure == null) {
                failure = new Outcome(CaseResultStatus.FAILED, FailureType.ASSERTION_FAILED,
                        check.get("label") + " 기대값 " + expected + ", 실제 " + value);
            }
        }
        updateStep(runId, caseId, step, failure == null ? StepStatus.PASSED : StepStatus.FAILED,
                String.join("\n", details), null, null, null);
        return failure;
    }

    private static String extract(String body, String jsonPath) {
        try {
            Object value = JsonPath.read(body, jsonPath);
            if (value == null) {
                return null;
            }
            if (value instanceof List<?> list) {
                return list.size() == 1 ? String.valueOf(list.get(0)) : String.valueOf(list);
            }
            return String.valueOf(value);
        } catch (RuntimeException ex) {
            return null;
        }
    }

    /** 교차 검증 행을 계산해 저장하고 verification 이벤트를 보낸다. 불일치가 있으면 true. */
    @SuppressWarnings("unchecked")
    private boolean crossCheck(UUID runId, UUID caseId, RunStep step, List<Map<String, Object>> crossChecks,
                               Map<String, String> captures, TestData data, Map<String, String> dbValues,
                               Set<String> skippedDbChecks) {
        updateStep(runId, caseId, step, StepStatus.RUNNING, null, null, null, null);
        List<Verification> rows = new ArrayList<>();
        boolean mismatch = false;
        int ord = 1;
        for (Map<String, Object> check : crossChecks) {
            String uiCapture = (String) check.get("uiCapture");
            String apiCapture = (String) check.get("apiCapture");
            String dbCheckId = (String) check.get("dbCheckId");
            String rawExpected = (String) check.get("expected");
            boolean consistencyOnly = Boolean.TRUE.equals(check.get("consistencyOnly"));
            Normalize normalize = normalizeOf(check.get("normalize"));
            String ui = uiCapture == null ? null : captures.get(uiCapture);
            String api = apiCapture == null ? null : captures.get(apiCapture);
            String db = dbCheckId == null ? null : dbValues.get(dbCheckId);
            String expected = rawExpected == null ? null
                    : TemplateValues.fill(rawExpected, data.variables(), data.secrets(), captures, false);
            boolean usedDb = dbCheckId != null && !skippedDbChecks.contains(dbCheckId);
            Verdict verdict = CrossCheckEvaluator.evaluate(new CrossCheckEvaluator.Input(uiCapture != null, ui,
                    apiCapture != null, api, usedDb, db, expected, consistencyOnly, normalize));
            // 비밀값은 verification 에 저장하지 않는다
            String storedExpected = rawExpected == null ? null
                    : TemplateValues.fill(rawExpected, data.variables(), data.secrets(), captures, true);
            String label = String.valueOf(check.getOrDefault("label", "검증 " + ord));
            rows.add(new Verification(caseId, ord++, label, ui, api, db, storedExpected, verdict));
            mismatch |= verdict == Verdict.MISMATCH;
        }
        store.replaceVerifications(caseId, rows);
        for (Verification v : rows) {
            Map<String, Object> fields = new LinkedHashMap<>();
            fields.put("caseResultId", caseId);
            fields.put("itemLabel", v.getItemLabel());
            fields.put("uiValue", v.getUiValue());
            fields.put("apiValue", v.getApiValue());
            fields.put("dbValue", v.getDbValue());
            fields.put("verdict", v.getVerdict());
            events.publish(runId, RunEventType.VERIFICATION, fields);
            log(runId, StepKind.ASSERT, verificationLine(v, crossChecks.get(v.getOrd() - 1), skippedDbChecks), caseId);
        }
        long mismatches = rows.stream().filter(v -> v.getVerdict() == Verdict.MISMATCH).count();
        updateStep(runId, caseId, step, mismatch ? StepStatus.FAILED : StepStatus.PASSED,
                mismatch ? "불일치 " + mismatches + "건" : "모두 일치", null, null, null);
        return mismatch;
    }

    /** 로그 문장: 지정한 출처만 보여 준다. 설정 때문에 건너뛴 DB 는 "건너뜀"으로 적는다. */
    private static String verificationLine(Verification v, Map<String, Object> check, Set<String> skippedDbChecks) {
        List<String> parts = new ArrayList<>();
        if (check.get("uiCapture") != null) {
            parts.add("화면 " + quoted(v.getUiValue()));
        }
        if (check.get("apiCapture") != null) {
            parts.add("API " + quoted(v.getApiValue()));
        }
        Object dbCheckId = check.get("dbCheckId");
        if (dbCheckId != null) {
            parts.add(skippedDbChecks.contains(String.valueOf(dbCheckId)) ? "DB 건너뜀" : "DB " + quoted(v.getDbValue()));
        }
        if (v.getExpectedValue() != null) {
            parts.add("기대 " + quoted(v.getExpectedValue()));
        } else if (Boolean.TRUE.equals(check.get("consistencyOnly"))) {
            parts.add("일치만 확인");
        }
        return v.getItemLabel() + ": " + String.join(" / ", parts) + " → " + v.getVerdict();
    }

    private static String quoted(String value) {
        return value == null ? "(값 없음)" : value.isEmpty() ? "(빈 값)" : value;
    }

    private static Normalize normalizeOf(Object value) {
        try {
            return value == null ? Normalize.NONE : Normalize.valueOf(value.toString());
        } catch (IllegalArgumentException ex) {
            return Normalize.NONE;
        }
    }

    // ------------------------------------------------------------------ 실행기

    /** 실행기 실행 결과. outcome 이 있으면 실행기 결과 대신 그 판정을 쓴다(요청 거부, 시간 초과 등). */
    record RunnerResult(Execution execution, Map<String, String> captures, Outcome outcome, boolean cancelledByUser) {
    }

    private RunnerResult execute(RunPlan plan, CasePlan c, int attempt, Map<String, Object> testQuery, TestData data,
                                 Map<Integer, RunStep> runnerSteps) {
        UUID runId = plan.runId();
        UUID caseId = c.caseResultId();
        UUID executionId = UUID.randomUUID();
        Map<String, Object> query = new LinkedHashMap<>(testQuery);
        query.put("variables", new LinkedHashMap<>(data.variables()));
        ExecutionRequest request = new ExecutionRequest(executionId, plan.targetUrl(), query,
                data.secrets().isEmpty() ? null : new LinkedHashMap<>(data.secrets()),
                new Viewport(plan.viewportWidth(), plan.viewportHeight()), (int) settings.caseTimeout().toMillis());
        Outcome rejected = startExecution(request);
        if (rejected != null) {
            return new RunnerResult(null, Map.of(), rejected, false);
        }
        // 실행기가 받아들인 시각부터 잰다 (RUNNER_BUSY 대기는 케이스 시간에 넣지 않는다)
        Instant startedAt = Instant.now();
        currentExecution.put(runId, executionId);
        log(runId, StepKind.UI, c.code() + " 실행 시작 (" + RunQueryService.specFileName(c.code()) + ")", caseId);

        EventContext ctx = new EventContext(runId, caseId, executionId, attempt, runnerSteps);
        Future<?> stream = streams.submit(() -> {
            try {
                runner.streamEvents(executionId, event -> handleEvent(ctx, event));
            } catch (RuntimeException ex) {
                log.warn("실행기 이벤트 스트림 끊김 ({}): {}", executionId, ex.getMessage());
            }
        });

        boolean cancelBefore = cancelRequested(runId);
        Execution finalState = waitForExecution(runId, executionId, stream, startedAt);
        boolean cancelledByUser = cancelBefore || cancelRequested(runId);
        try {
            stream.get(3, TimeUnit.SECONDS);
        } catch (Exception ignored) {
            stream.cancel(true);
        }
        currentExecution.remove(runId);
        applyFinalState(ctx, finalState);
        store.recordBrowser(runId, finalState.browserVersion());
        fetchFinalArtifacts(ctx, finalState);
        Map<String, String> captures = finalState.captures() == null ? Map.of() : finalState.captures();
        return new RunnerResult(finalState, captures, null, cancelledByUser);
    }

    private Outcome startExecution(ExecutionRequest request) {
        Instant busyDeadline = Instant.now().plus(settings.runnerBusyTimeout());
        while (true) {
            try {
                runner.startExecution(request);
                return null;
            } catch (RunnerUnavailableException ex) {
                throw new RunAbort("실행기에 연결할 수 없습니다");
            } catch (RunnerRequestRejectedException ex) {
                if ("DUPLICATE_EXECUTION".equals(ex.code())) {
                    // 앞선 요청이 이미 받아들여졌는데 응답만 잃은 경우 (같은 executionId 재전송)
                    return null;
                }
                if (ex.status() == 409 || "RUNNER_BUSY".equals(ex.code())) {
                    if (Instant.now().isAfter(busyDeadline)) {
                        throw new RunAbort("실행기가 계속 사용 중이라 실행할 수 없습니다");
                    }
                    sleep(settings.runnerBusyWait());
                    continue;
                }
                if ("TARGET_NOT_ALLOWED".equals(ex.code())) {
                    throw new RunAbort("실행기가 허용하지 않은 대상 사이트입니다 (RUNNER_ALLOWED_TARGET_HOSTS)");
                }
                return new Outcome(CaseResultStatus.ERROR, FailureType.TEST_CODE_ERROR,
                        "실행기가 TestQuery 를 거부했습니다: " + ex.getMessage());
            }
        }
    }

    /**
     * 실행이 끝날 때까지 기다린다. 중단 요청이면 실행기에 중단을 보내고, 시간 제한을 넘기면 중단 후 TIMEOUT.
     * 시간 제한은 시도 시작 시각 기준 바깥 타이머다. 이벤트 스트림이 조용해도(이벤트 0건) 같은 시각에 끝낸다.
     */
    private Execution waitForExecution(UUID runId, UUID executionId, Future<?> stream, Instant startedAt) {
        Instant deadline = startedAt.plus(settings.caseTimeout()).plus(settings.caseTimeoutGrace());
        boolean cancelSent = false;
        long lastPoll = 0;
        while (true) {
            if (!cancelSent && cancelRequested(runId)) {
                runner.cancelExecution(executionId);
                cancelSent = true;
            }
            long now = System.currentTimeMillis();
            if (stream.isDone() || now - lastPoll > 2000) {
                lastPoll = now;
                try {
                    Execution e = runner.getExecution(executionId);
                    if (e.isTerminal()) {
                        return e;
                    }
                } catch (RunnerUnavailableException ex) {
                    throw new RunAbort("실행기에 연결할 수 없습니다");
                } catch (RunnerRequestRejectedException ex) {
                    if (stream.isDone()) {
                        throw new RunAbort("실행기에서 실행을 찾을 수 없습니다: " + ex.getMessage());
                    }
                }
            }
            if (Instant.now().isAfter(deadline)) {
                runner.cancelExecution(executionId);
                return new Execution(executionId.toString(), "FAILED", null, null, "TIMEOUT",
                        "케이스 실행 시간 제한(" + settings.caseTimeout().toSeconds() + "초)을 넘겼습니다", null, null, null,
                        null, null);
            }
            sleep(Duration.ofMillis(200));
        }
    }

    /** 실행기 이벤트 처리에 필요한 값. 이벤트 스트림 스레드에서 쓴다. */
    private static final class EventContext {
        final UUID runId;
        final UUID caseId;
        final UUID executionId;
        final int attempt;
        final Map<Integer, RunStep> runnerSteps;
        final Set<String> fetchedFiles = ConcurrentHashMap.newKeySet();
        final AtomicInteger apiCalls = new AtomicInteger();
        final AtomicBoolean sawSteps = new AtomicBoolean();
        final Set<String> streamedLogs = ConcurrentHashMap.newKeySet();

        EventContext(UUID runId, UUID caseId, UUID executionId, int attempt, Map<Integer, RunStep> runnerSteps) {
            this.runId = runId;
            this.caseId = caseId;
            this.executionId = executionId;
            this.attempt = attempt;
            this.runnerSteps = runnerSteps;
        }
    }

    /** 실행기 이벤트 → run 이벤트 (events.md). 이벤트 하나의 오류가 실행을 멈추지 않게 한다. */
    private void handleEvent(EventContext ctx, ExecutionEvent event) {
        try {
            JsonNode d = event.data();
            switch (event.type()) {
                case "step" -> {
                    RunStep step = ctx.runnerSteps.get(d.path("order").asInt());
                    if (step != null) {
                        ctx.sawSteps.set(true);
                        updateStep(ctx.runId, ctx.caseId, step, stepStatus(d.path("status").asText()),
                                text(d, "detail"), text(d, "expectedValue"), text(d, "actualValue"), null);
                    }
                }
                case "api.call" -> {
                    ctx.apiCalls.incrementAndGet();
                    saveApiCall(ctx, text(d, "method"), text(d, "path"), intOrNull(d, "statusCode"),
                            intOrNull(d, "durationMs"), text(d, "occurredAt"));
                }
                case "screenshot" -> {
                    String name = text(d, "name");
                    RunStep step = ctx.runnerSteps.get(d.path("order").asInt());
                    if (name != null) {
                        fetchScreenshot(ctx, name, step, text(d, "pagePath"));
                    }
                }
                case "log" -> {
                    String message = text(d, "message");
                    if (message != null) {
                        ctx.streamedLogs.add(clean(message));
                    }
                    log(ctx.runId, stepKind(text(d, "kind")), message, ctx.caseId);
                }
                default -> {
                    // status 는 최종 결과로 처리한다
                }
            }
        } catch (RuntimeException ex) {
            log.warn("실행기 이벤트 처리 실패 ({}): {}", event.type(), ex.getMessage());
        }
    }

    private void saveApiCall(EventContext ctx, String method, String path, Integer statusCode, Integer durationMs,
                             String occurredAt) {
        Instant at = parseInstant(occurredAt);
        ApiCallEntry saved = store.saveApiCall(ctx.runId, ctx.caseId, method == null ? "GET" : method,
                path == null ? "/" : path, statusCode, durationMs, at);
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("id", saved.getId());
        fields.put("method", saved.getMethod());
        fields.put("path", saved.getPath());
        fields.put("statusCode", saved.getStatusCode());
        fields.put("durationMs", saved.getDurationMs());
        events.publish(ctx.runId, RunEventType.API_CALL, fields);
    }

    private void fetchScreenshot(EventContext ctx, String name, RunStep step, String pagePath) {
        if (!ctx.fetchedFiles.add(name)) {
            return;
        }
        Artifact artifact = fetchArtifact(ctx, name, ArtifactType.SCREENSHOT, pagePath);
        if (artifact == null) {
            return;
        }
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("artifactId", artifact.getId());
        fields.put("caseResultId", ctx.caseId);
        fields.put("stepId", step == null ? null : step.getId());
        fields.put("path", pagePath);
        events.publish(ctx.runId, RunEventType.SCREENSHOT, fields);
    }

    private Artifact fetchArtifact(EventContext ctx, String name, ArtifactType type, String label) {
        for (int i = 0; i < 5; i++) {
            try {
                ArtifactFile file = runner.getArtifact(ctx.executionId, name);
                String key = "run-artifacts/" + ctx.runId + "/" + ctx.caseId + "/attempt-" + ctx.attempt + "/" + name;
                return store.saveArtifact(ctx.runId, ctx.caseId, type, key, file.content(),
                        contentTypeOf(name, file.contentType()), label == null ? name : label);
            } catch (RunnerRequestRejectedException ex) {
                if (ex.status() == 409) {
                    sleep(Duration.ofMillis(500));
                    continue;
                }
                log.warn("실행 증거를 가져오지 못했습니다 ({}): {}", name, ex.getMessage());
                return null;
            } catch (RunnerUnavailableException ex) {
                log.warn("실행 증거를 가져오지 못했습니다 ({}): {}", name, ex.getMessage());
                return null;
            }
        }
        return null;
    }

    private static String contentTypeOf(String name, String reported) {
        if (name.endsWith(".png")) {
            return "image/png";
        }
        if (name.endsWith(".zip")) {
            return "application/zip";
        }
        if (name.endsWith(".har")) {
            return "application/json";
        }
        return reported;
    }

    /** 최종 결과로 단계 상태·스키마 검사·API 호출을 맞춘다 (늦게 붙어 놓친 이벤트 보완). */
    private void applyFinalState(EventContext ctx, Execution e) {
        if (e.steps() != null) {
            for (StepResult r : e.steps()) {
                RunStep step = r.order() == null ? null : ctx.runnerSteps.get(r.order());
                if (step == null) {
                    continue;
                }
                String detail = clean(r.detail());
                if (r.schemaErrors() != null && !r.schemaErrors().isEmpty()) {
                    detail = (detail == null ? "" : detail + "\n") + "응답 구조 오류: " + String.join("; ", r.schemaErrors());
                }
                SchemaCheckStatus schema = r.schemaCheck() == null ? null : SchemaCheckStatus.valueOf(r.schemaCheck());
                updateStep(ctx.runId, ctx.caseId, step, stepStatus(r.status()), detail, clean(r.expectedValue()),
                        clean(r.actualValue()), schema);
            }
        }
        if (ctx.apiCalls.get() == 0 && e.apiCalls() != null) {
            e.apiCalls().forEach(a -> saveApiCall(ctx, a.method(), a.path(), a.statusCode(), a.durationMs(),
                    a.occurredAt()));
        }
        if (e.consoleErrors() != null) {
            // 실행기가 log 이벤트로 이미 보낸 콘솔 오류는 다시 남기지 않는다 (스트림이 끊긴 경우만 보충)
            e.consoleErrors().stream().map(RunWorker::clean)
                    .filter(msg -> msg != null && ctx.streamedLogs.stream().noneMatch(l -> l != null && l.contains(msg)))
                    .forEach(msg -> log(ctx.runId, StepKind.UI, "브라우저 콘솔 오류: " + msg, ctx.caseId));
        }
    }

    private void fetchFinalArtifacts(EventContext ctx, Execution e) {
        if (e.artifacts() == null) {
            return;
        }
        for (ArtifactRef ref : e.artifacts()) {
            if (ref.name() == null || ctx.fetchedFiles.contains(ref.name())) {
                continue;
            }
            switch (String.valueOf(ref.kind())) {
                case "SCREENSHOT" -> {
                    // 파일 이름의 번호는 TestQuery 단계 순서(실행기 order)다
                    RunStep step = ctx.runnerSteps.entrySet().stream()
                            .filter(entry -> ref.name().equals("step-" + entry.getKey() + ".png"))
                            .map(Map.Entry::getValue).findFirst().orElse(null);
                    fetchScreenshot(ctx, ref.name(), step, null);
                }
                case "TRACE" -> {
                    ctx.fetchedFiles.add(ref.name());
                    fetchArtifact(ctx, ref.name(), ArtifactType.TRACE, "Playwright trace");
                }
                case "HAR" -> {
                    ctx.fetchedFiles.add(ref.name());
                    fetchArtifact(ctx, ref.name(), ArtifactType.HAR, "네트워크 HAR");
                }
                default -> {
                    // 알 수 없는 종류는 가져오지 않는다
                }
            }
        }
    }

    // ------------------------------------------------------------------ 이벤트 도우미

    private void updateStep(UUID runId, UUID caseId, RunStep step, StepStatus status, String detail, String expected,
                            String actual, SchemaCheckStatus schemaCheck) {
        RunStep updated = store.updateStep(step.getId(), status, detail, expected, actual, schemaCheck);
        publishStep(runId, caseId, updated);
    }

    private void publishStep(UUID runId, UUID caseId, RunStep s) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("caseResultId", caseId);
        fields.put("stepId", s.getId());
        fields.put("order", s.getOrd());
        fields.put("attempt", s.getAttempt());
        fields.put("kind", s.getKind());
        fields.put("title", s.getTitle());
        fields.put("status", s.getStatus());
        fields.put("expectedValue", s.getExpectedValue());
        fields.put("actualValue", s.getActualValue());
        events.publish(runId, RunEventType.STEP_STATUS, fields);
    }

    private void publishCaseStatus(UUID runId, CasePlan c) {
        CaseResult cr = store.caseResult(c.caseResultId());
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("caseResultId", cr.getId());
        fields.put("code", c.code());
        fields.put("status", cr.getStatus());
        fields.put("attempt", cr.getAttempts());
        fields.put("failedAttempts", cr.getFailedAttempts());
        events.publish(runId, RunEventType.CASE_STATUS, fields);
    }

    private void publishScenarioStatus(RunPlan plan, UUID scenarioRunId) {
        ScenarioPlan scenario = plan.scenarios().stream().filter(s -> s.scenarioRunId().equals(scenarioRunId))
                .findFirst().orElse(null);
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("scenarioRunId", scenarioRunId);
        fields.put("code", scenario == null ? null : scenario.code());
        ScenarioRun sr = store.scenarioRun(scenarioRunId);
        fields.put("status", sr.getStatus());
        fields.put("durationMs", sr.getDurationMs());
        events.publish(plan.runId(), RunEventType.SCENARIO_STATUS, fields);
        // 시나리오 상태가 바뀌면 진행 집계(progress)도 갱신해 보낸다 (A14, events.md). 끝 상태는 따로 보낸다
        if (!queries.find(plan.runId()).getStatus().isTerminal()) {
            publishRunStatus(plan.runId());
        }
    }

    private void publishRunStatus(UUID runId) {
        TestRun run = queries.find(runId);
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("status", run.getStatus());
        fields.put("progress", objectMapper.convertValue(queries.progress(runId), Map.class));
        fields.put("errorMessage", run.getErrorMessage());
        events.publish(runId, RunEventType.RUN_STATUS, fields);
    }

    private void log(UUID runId, StepKind kind, String message, UUID caseId) {
        if (message == null) {
            return;
        }
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("kind", kind);
        fields.put("message", message);
        fields.put("caseResultId", caseId);
        events.publish(runId, RunEventType.LOG, fields);
    }

    private static StepStatus stepStatus(String value) {
        try {
            return value == null ? StepStatus.RUNNING : StepStatus.valueOf(value);
        } catch (IllegalArgumentException ex) {
            return StepStatus.RUNNING;
        }
    }

    private static StepKind stepKind(String value) {
        try {
            return value == null ? StepKind.UI : StepKind.valueOf(value);
        } catch (IllegalArgumentException ex) {
            return StepKind.UI;
        }
    }

    private static String text(JsonNode node, String field) {
        return node.hasNonNull(field) ? clean(node.get(field).asText()) : null;
    }

    private static final java.util.regex.Pattern ANSI = java.util.regex.Pattern.compile("\u001B\\[[0-9;?]*[ -/]*[@-~]");

    /** 실행기 문장의 터미널 색 코드(ESC[2m 등)를 지운다. 저장·화면·AI 요청에 섞이지 않게 한다. */
    static String clean(String value) {
        return value == null ? null : ANSI.matcher(value).replaceAll("");
    }

    private static Integer intOrNull(JsonNode node, String field) {
        return node.hasNonNull(field) && node.get(field).canConvertToInt() ? node.get(field).asInt() : null;
    }

    private static Instant parseInstant(String value) {
        try {
            return value == null ? Times.now() : Instant.parse(value);
        } catch (RuntimeException ex) {
            return Times.now();
        }
    }

    private static void sleep(Duration duration) {
        try {
            Thread.sleep(duration.toMillis());
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new RunAbort("실행 작업이 중단되었습니다");
        }
    }
}
