package com.skrr.platform.scenario;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skrr.platform.client.ai.AiClient;
import com.skrr.platform.client.ai.AiJob;
import com.skrr.platform.client.ai.GeneratedScenario;
import com.skrr.platform.client.ai.GeneratedScenario.GeneratedCase;
import com.skrr.platform.client.ai.ScenarioGenerationRequest;
import com.skrr.platform.client.ai.ScenarioGenerationResult;
import com.skrr.platform.common.job.AiFailureMessages;
import com.skrr.platform.common.job.AsyncJob;
import com.skrr.platform.common.job.AsyncJobHandler;
import com.skrr.platform.common.job.InvalidJobResultException;
import com.skrr.platform.common.job.JobType;
import com.skrr.platform.project.ActivityService;
import com.skrr.platform.request.TestRequest;
import com.skrr.platform.request.TestRequestRepository;
import com.skrr.platform.request.TestRequestStatus;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * SCENARIO_GENERATE 작업 (FR-03). 대상이 TEST_REQUEST 이면 요청 단위 첫 생성(끝날 때 한꺼번에 저장, U2),
 * SCENARIO 이면 시나리오 1건 재생성이다.
 */
@Component
public class ScenarioGenerationJobHandler implements AsyncJobHandler {

    private static final Logger log = LoggerFactory.getLogger(ScenarioGenerationJobHandler.class);

    private final AiClient ai;
    private final TestRequestRepository requests;
    private final ScenarioRepository scenarios;
    private final TestCaseRepository testCases;
    private final ActivityService activities;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate tx;

    public ScenarioGenerationJobHandler(AiClient ai, TestRequestRepository requests, ScenarioRepository scenarios,
                                        TestCaseRepository testCases, ActivityService activities, ObjectMapper objectMapper,
                                        TransactionTemplate tx) {
        this.ai = ai;
        this.requests = requests;
        this.scenarios = scenarios;
        this.testCases = testCases;
        this.activities = activities;
        this.objectMapper = objectMapper;
        this.tx = tx;
    }

    @Override
    public JobType type() {
        return JobType.SCENARIO_GENERATE;
    }

    private static boolean isRegeneration(AsyncJob job) {
        return ScenarioService.JOB_SUBJECT.equals(job.getSubjectType());
    }

    @Override
    public AiJob submit(AsyncJob job) {
        ScenarioGenerationRequest request = tx.execute(status -> isRegeneration(job)
                ? regenerationRequest(job.getSubjectId(), feedbackOf(job))
                : firstRequest(job.getSubjectId()));
        return ai.startScenarioGeneration(request);
    }

    private ScenarioGenerationRequest firstRequest(UUID testRequestId) {
        TestRequest request = requests.findById(testRequestId).orElseThrow();
        return new ScenarioGenerationRequest(request.getProjectId(), request.code(), request.getSelectedText(), 1, 1,
                null);
    }

    /** 재생성: 시나리오 번호 유지, 새 케이스 번호 = 요청 안 TC 번호 최댓값 + 1 (비활성 포함). */
    private static String feedbackOf(AsyncJob job) {
        Object value = job.getRequestPayload() == null ? null : job.getRequestPayload().get(ScenarioService.FEEDBACK_KEY);
        return value instanceof String text && !text.isBlank() ? text : null;
    }

    private ScenarioGenerationRequest regenerationRequest(UUID scenarioId, String feedback) {
        Scenario scenario = scenarios.findById(scenarioId).orElseThrow();
        TestRequest request = requests.findById(scenario.getTestRequestId()).orElseThrow();
        int nextCase = testCases.findByTestRequestId(request.getId()).stream()
                .mapToInt(TestCase::number).max().orElse(0) + 1;
        GeneratedScenario previous = new GeneratedScenario(scenario.getCode(), scenario.getTitle(),
                scenario.getRequirementRef(), scenario.getScopes(), scenario.getReferences(),
                new GeneratedScenario.Guard(scenario.getGuardFailures().isEmpty(),
                        Math.max(1, scenario.getGuardAttempt()), scenario.getGuardFailures()),
                testCases.findByScenarioIdAndActiveTrueOrderByOrdAsc(scenarioId).stream()
                        .map(c -> new GeneratedCase(c.getCode(), c.getTitle(), c.getType(), c.getScopes(),
                                c.getPreconditions(), c.getSteps(), c.getExpectedResult(), c.getExpectedValues()))
                        .toList());
        return new ScenarioGenerationRequest(request.getProjectId(), request.code(), request.getSelectedText(),
                scenario.number(), nextCase,
                new ScenarioGenerationRequest.Regenerate(scenario.getCode(), previous, feedback));
    }

    /** 재생성 중 가드 재시도 진행을 반영한다 (attempt 2 이상이면 GUARD_RETRY). 첫 생성은 행이 없어 반영하지 않는다. */
    @Override
    public void onProgress(AsyncJob job, AiJob remote) {
        if (!isRegeneration(job) || remote.progress() == null || remote.progress().attempt() == null) {
            return;
        }
        scenarios.findByIdForUpdate(job.getSubjectId())
                .filter(s -> s.getStatus().isGenerating())
                .ifPresent(s -> s.regenerationProgress(remote.progress().attempt(), remote.progress().message()));
    }

    @Override
    public void onSucceeded(AsyncJob job, AiJob remote) {
        ScenarioGenerationResult result = parse(remote);
        if (isRegeneration(job)) {
            saveRegeneration(job.getSubjectId(), result);
        } else {
            saveFirstGeneration(job.getSubjectId(), result);
        }
    }

    private void saveFirstGeneration(UUID testRequestId, ScenarioGenerationResult result) {
        List<GeneratedScenario> generated = GenerationResultValidator.validate(result, Set.of());
        Optional<TestRequest> maybe = requests.findByIdForUpdate(testRequestId);
        if (maybe.isEmpty() || maybe.get().getStatus() != TestRequestStatus.GENERATING
                || scenarios.countByTestRequestId(testRequestId) > 0) {
            log.warn("생성 중이 아닌 요청의 결과를 무시합니다: {}", testRequestId);
            return;
        }
        TestRequest request = maybe.get();
        int caseCount = 0;
        for (GeneratedScenario g : generated) {
            Scenario scenario = scenarios.saveAndFlush(new Scenario(testRequestId, g.code(), content(g), guard(g)));
            caseCount += saveCases(scenario, g.testCases());
        }
        request.generated();
        activities.record(request.getProjectId(), request.code() + " 시나리오 " + generated.size() + "개 · 테스트 케이스 "
                + caseCount + "개 생성");
    }

    private void saveRegeneration(UUID scenarioId, ScenarioGenerationResult result) {
        Optional<Scenario> maybe = scenarios.findByIdForUpdate(scenarioId);
        if (maybe.isEmpty() || !maybe.get().getStatus().isGenerating()) {
            log.warn("재생성 중이 아닌 시나리오의 결과를 무시합니다: {}", scenarioId);
            return;
        }
        Scenario scenario = maybe.get();
        Set<String> usedCaseCodes = testCases.findByTestRequestId(scenario.getTestRequestId()).stream()
                .map(TestCase::getCode).collect(Collectors.toSet());
        List<GeneratedScenario> generated = GenerationResultValidator.validate(result, usedCaseCodes);
        if (generated.size() != 1 || !scenario.getCode().equals(generated.get(0).code())) {
            throw new InvalidJobResultException("AI 재생성 결과가 계약과 다릅니다: " + scenario.getCode()
                    + " 시나리오 1건이 와야 합니다");
        }
        GeneratedScenario g = generated.get(0);
        testCases.findByScenarioIdAndActiveTrueOrderByOrdAsc(scenarioId).forEach(TestCase::deactivate);
        testCases.flush();
        scenario.regenerated(content(g), guard(g));
        int caseCount = saveCases(scenario, g.testCases());
        TestRequest request = requests.findById(scenario.getTestRequestId()).orElseThrow();
        activities.record(request.getProjectId(), request.code() + " " + scenario.getCode() + " 시나리오 재생성 완료 (v"
                + scenario.getVersion() + ", 케이스 " + caseCount + "개"
                + (scenario.getStatus() == ScenarioStatus.GUARD_FAILED ? ", 가드 실패" : "") + ")");
    }

    private int saveCases(Scenario scenario, List<GeneratedCase> cases) {
        for (int i = 0; i < cases.size(); i++) {
            GeneratedCase c = cases.get(i);
            testCases.save(new TestCase(scenario.getId(), scenario.getTestRequestId(), c.code(), i + 1,
                    new TestCase.Content(c.title().strip(), c.type(), c.scopes(), c.preconditions(), c.steps(),
                            c.expectedResult(), c.expectedValues())));
        }
        return cases.size();
    }

    @Override
    public void onFailed(AsyncJob job, String message) {
        onFailed(job, message, null);
    }

    @Override
    public void onFailed(AsyncJob job, String message, AiJob remote) {
        String userMessage = AiFailureMessages.forUser(message, remote);
        if (isRegeneration(job)) {
            scenarios.findByIdForUpdate(job.getSubjectId()).ifPresent(scenario -> {
                scenario.regenerationFailed("재생성 실패: " + userMessage);
                requests.findById(scenario.getTestRequestId()).ifPresent(request -> activities.record(
                        request.getProjectId(), request.code() + " " + scenario.getCode() + " 시나리오 재생성 실패: "
                                + userMessage));
            });
            return;
        }
        requests.findByIdForUpdate(job.getSubjectId())
                .filter(r -> r.getStatus() == TestRequestStatus.GENERATING)
                .ifPresent(request -> {
                    request.fail(userMessage);
                    activities.record(request.getProjectId(), request.code() + " 시나리오 생성 실패: " + userMessage);
                });
    }

    private static Scenario.Content content(GeneratedScenario g) {
        return new Scenario.Content(g.title().strip(), g.requirementRef(), g.scopes(), g.references());
    }

    private static Scenario.Guard guard(GeneratedScenario g) {
        return new Scenario.Guard(g.guard().passed(), g.guard().attempts(),
                g.guard().failures() == null ? List.of() : g.guard().failures());
    }

    private ScenarioGenerationResult parse(AiJob remote) {
        if (remote.result() == null || remote.result().isNull()) {
            throw new InvalidJobResultException("AI 시나리오 생성 작업이 성공했지만 결과가 없습니다");
        }
        try {
            return objectMapper.treeToValue(remote.result(), ScenarioGenerationResult.class);
        } catch (JsonProcessingException | IllegalArgumentException ex) {
            throw new InvalidJobResultException("AI 시나리오 생성 결과 형식이 계약과 다릅니다: " + ex.getMessage());
        }
    }
}
