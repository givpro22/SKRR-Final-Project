package com.skrr.platform.scenario;

import com.skrr.platform.common.error.ApiException;
import com.skrr.platform.common.error.ErrorCode;
import com.skrr.platform.common.job.AsyncJob;
import com.skrr.platform.common.job.AsyncJobRepository;
import com.skrr.platform.common.job.JobType;
import com.skrr.platform.common.time.Times;
import com.skrr.platform.common.user.CurrentUserProvider;
import com.skrr.platform.project.ActivityService;
import com.skrr.platform.request.TestRequest;
import com.skrr.platform.request.TestRequestRepository;
import com.skrr.platform.request.TestRequestService;
import com.skrr.platform.scenario.ScenarioDtos.ScenarioListResponse;
import com.skrr.platform.scenario.ScenarioDtos.ScenarioResponse;
import com.skrr.platform.scenario.ScenarioDtos.ScenarioUpdate;
import com.skrr.platform.scenario.ScenarioDtos.Summary;
import com.skrr.platform.scenario.ScenarioDtos.TestCaseResponse;
import com.skrr.platform.scenario.ScenarioDtos.TestCaseUpdate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 시나리오·케이스 조회, 수정, 승인·반려, 재생성 (FR-03, UI-02-5). */
@Service
public class ScenarioService {

    public static final String JOB_SUBJECT = "SCENARIO";
    /** async_job.request_payload 의 재생성 의견 키. */
    public static final String FEEDBACK_KEY = "feedback";

    private final ScenarioRepository scenarios;
    private final TestCaseRepository testCases;
    private final TestRequestRepository requests;
    private final TestRequestService requestService;
    private final AsyncJobRepository jobs;
    private final ActivityService activities;
    private final CurrentUserProvider currentUser;

    public ScenarioService(ScenarioRepository scenarios, TestCaseRepository testCases, TestRequestRepository requests,
                           TestRequestService requestService, AsyncJobRepository jobs, ActivityService activities,
                           CurrentUserProvider currentUser) {
        this.scenarios = scenarios;
        this.testCases = testCases;
        this.requests = requests;
        this.requestService = requestService;
        this.jobs = jobs;
        this.activities = activities;
        this.currentUser = currentUser;
    }

    /** operationId: listScenarios. 활성 케이스만 싣고, summary 는 상태별 수(합 = total). */
    @Transactional(readOnly = true)
    public ScenarioListResponse list(UUID testRequestId) {
        TestRequest request = requests.findById(testRequestId).orElseThrow(() -> ApiException.notFound("테스트 요청"));
        List<Scenario> found = scenarios.findByTestRequestIdOrderByCodeAsc(testRequestId);
        Map<UUID, List<TestCase>> casesByScenario = found.isEmpty() ? Map.of()
                : testCases.findByScenarioIdInAndActiveTrueOrderByOrdAsc(found.stream().map(Scenario::getId).toList())
                        .stream().collect(Collectors.groupingBy(TestCase::getScenarioId));
        List<ScenarioResponse> items = found.stream()
                .map(s -> ScenarioResponse.from(s, casesByScenario.getOrDefault(s.getId(), List.of())))
                .toList();
        return new ScenarioListResponse(requestService.view(request), summary(found), items);
    }

    @Transactional(readOnly = true)
    public ScenarioResponse get(UUID scenarioId) {
        return view(find(scenarioId));
    }

    @Transactional(readOnly = true)
    public TestCaseResponse getTestCase(UUID testCaseId) {
        return TestCaseResponse.from(findCase(testCaseId));
    }

    /** operationId: updateScenario. 생성 중이면 409, 내용이 바뀌면 version 증가·승인 해제. */
    @Transactional
    public ScenarioResponse update(UUID scenarioId, ScenarioUpdate patch) {
        Scenario scenario = lock(scenarioId);
        if (scenario.edit(patch.getTitle() == null ? null : patch.getTitle().strip(), patch.hasRequirementRef(),
                patch.getRequirementRef(), patch.getScopes())) {
            record(scenario, scenario.getCode() + " 시나리오 수정 (v" + scenario.getVersion() + ")");
        }
        scenarios.flush();
        return view(scenario);
    }

    /**
     * operationId: updateTestCase. 시나리오가 생성 중이거나 케이스가 비활성이면 409.
     * 바뀌면 케이스·시나리오 version 을 올리고 시나리오 승인을 해제한다 (FR-03, ADR-017).
     */
    @Transactional
    public TestCaseResponse updateTestCase(UUID testCaseId, TestCaseUpdate patch) {
        if (patch.expectedValues() != null) {
            for (int i = 0; i < patch.expectedValues().size(); i++) {
                String violation = patch.expectedValues().get(i).violation();
                if (violation != null) {
                    throw ApiException.invalidField("expectedValues[" + i + "]", violation);
                }
            }
        }
        TestCase testCase = findCase(testCaseId);
        Scenario scenario = lock(testCase.getScenarioId());
        scenario.requireEditable();
        if (!testCase.isActive()) {
            throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION,
                    "재생성으로 대체된 케이스는 고칠 수 없습니다.");
        }
        boolean changed = testCase.edit(new TestCase.Content(
                patch.title() == null ? null : patch.title().strip(), patch.type(), patch.scopes(),
                patch.preconditions(), patch.steps(), patch.expectedResult(), patch.expectedValues()));
        if (changed) {
            scenario.contentChangedByUser();
            record(scenario, scenario.getCode() + " " + testCase.getCode() + " 케이스 수정 (v" + testCase.getVersion() + ")");
        }
        testCases.flush();
        return TestCaseResponse.from(testCase);
    }

    /** operationId: approveScenario. REVIEW_REQUIRED 에서만. */
    @Transactional
    public ScenarioResponse approve(UUID scenarioId) {
        Scenario scenario = lock(scenarioId);
        scenario.approve(currentUser.currentUserId(), Times.now());
        record(scenario, scenario.getCode() + " 시나리오 승인");
        scenarios.flush();
        return view(scenario);
    }

    /** operationId: rejectScenario. REVIEW_REQUIRED 에서만. */
    @Transactional
    public ScenarioResponse reject(UUID scenarioId) {
        Scenario scenario = lock(scenarioId);
        scenario.reject();
        record(scenario, scenario.getCode() + " 시나리오 반려");
        scenarios.flush();
        return view(scenario);
    }

    /**
     * operationId: regenerateScenario. REVIEW_REQUIRED, APPROVED, REJECTED, GUARD_FAILED 에서 받아 GENERATING 으로.
     * 결과가 오면 코드를 유지하고 version 을 올리며, 옛 케이스는 비활성, 새 케이스는 새 TC 번호를 받는다.
     */
    @Transactional
    public ScenarioResponse regenerate(UUID scenarioId, String userFeedback) {
        Scenario scenario = lock(scenarioId);
        scenario.startRegeneration();
        String note = userFeedback == null || userFeedback.isBlank() ? null : userFeedback.strip();
        jobs.save(new AsyncJob(JobType.SCENARIO_GENERATE, JOB_SUBJECT, scenario.getId(),
                note == null ? null : Map.of(FEEDBACK_KEY, note)));
        record(scenario, scenario.getCode() + " 시나리오 재생성 요청");
        scenarios.flush();
        return view(scenario);
    }

    private Scenario find(UUID scenarioId) {
        return scenarios.findById(scenarioId).orElseThrow(() -> ApiException.notFound("시나리오"));
    }

    private Scenario lock(UUID scenarioId) {
        return scenarios.findByIdForUpdate(scenarioId).orElseThrow(() -> ApiException.notFound("시나리오"));
    }

    private TestCase findCase(UUID testCaseId) {
        return testCases.findById(testCaseId).orElseThrow(() -> ApiException.notFound("테스트 케이스"));
    }

    private ScenarioResponse view(Scenario scenario) {
        return ScenarioResponse.from(scenario, testCases.findByScenarioIdAndActiveTrueOrderByOrdAsc(scenario.getId()));
    }

    private void record(Scenario scenario, String message) {
        TestRequest request = requests.findById(scenario.getTestRequestId()).orElseThrow();
        activities.record(request.getProjectId(), request.code() + " " + message);
    }

    static Summary summary(List<Scenario> found) {
        Map<ScenarioStatus, Long> counts = found.stream()
                .collect(Collectors.groupingBy(Scenario::getStatus, Collectors.counting()));
        return new Summary(found.size(),
                count(counts, ScenarioStatus.APPROVED), count(counts, ScenarioStatus.REVIEW_REQUIRED),
                count(counts, ScenarioStatus.GUARD_RETRY), count(counts, ScenarioStatus.GENERATING),
                count(counts, ScenarioStatus.REJECTED), count(counts, ScenarioStatus.GUARD_FAILED));
    }

    private static int count(Map<ScenarioStatus, Long> counts, ScenarioStatus status) {
        return counts.getOrDefault(status, 0L).intValue();
    }
}
