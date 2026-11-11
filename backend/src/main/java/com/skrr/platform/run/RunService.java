package com.skrr.platform.run;

import com.skrr.platform.common.error.ApiException;
import com.skrr.platform.common.error.ErrorCode;
import com.skrr.platform.common.user.CurrentUserProvider;
import com.skrr.platform.document.Document;
import com.skrr.platform.document.DocumentRepository;
import com.skrr.platform.project.ActivityService;
import com.skrr.platform.project.Project;
import com.skrr.platform.project.ProjectRepository;
import com.skrr.platform.request.TestRequest;
import com.skrr.platform.request.TestRequestRepository;
import com.skrr.platform.run.RunDtos.RunResponse;
import com.skrr.platform.run.RunEnums.RunEventType;
import com.skrr.platform.scenario.Scenario;
import com.skrr.platform.scenario.ScenarioRepository;
import com.skrr.platform.scenario.ScenarioStatus;
import com.skrr.platform.scenario.TestCase;
import com.skrr.platform.scenario.TestCaseRepository;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 실행 시작·중단 (FR-04, FR-05). 실행 자체는 RunWorker 가 한다. */
@Service
public class RunService {

    /** 플랫폼 전체에서 진행 중 실행 1개를 지키는 advisory lock 키 (U3). */
    static final long ACTIVE_RUN_LOCK = 7_342_001L;

    private final TestRunRepository runs;
    private final ScenarioRunRepository scenarioRuns;
    private final CaseResultRepository caseResults;
    private final TestRequestRepository requests;
    private final ScenarioRepository scenarios;
    private final TestCaseRepository testCases;
    private final ProjectRepository projects;
    private final DocumentRepository documents;
    private final ActivityService activities;
    private final CurrentUserProvider currentUser;
    private final RunQueryService queries;
    private final RunWorker worker;
    private final RunEventPublisher events;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    public RunService(TestRunRepository runs, ScenarioRunRepository scenarioRuns, CaseResultRepository caseResults,
                      TestRequestRepository requests, ScenarioRepository scenarios, TestCaseRepository testCases,
                      ProjectRepository projects, DocumentRepository documents, ActivityService activities,
                      CurrentUserProvider currentUser, RunQueryService queries, RunWorker worker,
                      RunEventPublisher events, JdbcTemplate jdbc, TransactionTemplate tx) {
        this.runs = runs;
        this.scenarioRuns = scenarioRuns;
        this.caseResults = caseResults;
        this.requests = requests;
        this.scenarios = scenarios;
        this.testCases = testCases;
        this.projects = projects;
        this.documents = documents;
        this.activities = activities;
        this.currentUser = currentUser;
        this.queries = queries;
        this.worker = worker;
        this.events = events;
        this.jdbc = jdbc;
        this.tx = tx;
    }

    /**
     * operationId: startRun. 400(다른 요청의 시나리오) → 409 SCENARIO_NOT_APPROVED → 409 RUN_ALREADY_ACTIVE(전체 기준)
     * → 409 TARGET_URL_MISSING 순으로 검사한다. 202 뒤 PREPARING.
     */
    @Transactional
    public RunResponse start(UUID testRequestId, List<UUID> scenarioIds) {
        if (new HashSet<>(scenarioIds).size() != scenarioIds.size()) {
            throw ApiException.invalidField("scenarioIds", "같은 시나리오를 두 번 넣을 수 없습니다.");
        }
        TestRequest request = requests.findById(testRequestId).orElseThrow(() -> ApiException.notFound("테스트 요청"));
        List<Scenario> selected = scenarios.findAllById(scenarioIds);
        if (selected.size() != scenarioIds.size()
                || selected.stream().anyMatch(s -> !s.getTestRequestId().equals(testRequestId))) {
            throw ApiException.invalidField("scenarioIds", "이 요청의 시나리오가 아닌 항목이 있습니다.");
        }
        List<String> notApproved = selected.stream().filter(s -> s.getStatus() != ScenarioStatus.APPROVED)
                .map(Scenario::getCode).sorted().toList();
        if (!notApproved.isEmpty()) {
            throw new ApiException(ErrorCode.SCENARIO_NOT_APPROVED,
                    "승인되지 않은 시나리오가 있어 실행할 수 없습니다: " + String.join(", ", notApproved));
        }
        selected = selected.stream().sorted(Comparator.comparing(Scenario::getCode)).toList();
        lockAndCheckActive();
        Project project = requireTarget(request.getProjectId());
        TestRun run = runs.saveAndFlush(new TestRun(project.getId(), testRequestId, runs.findMaxSeq(project.getId()) + 1,
                project.getTargetUrl(), documentVersions(project.getId()), currentUser.currentUserId()));
        Map<UUID, List<TestCase>> casesByScenario = testCases
                .findByScenarioIdInAndActiveTrueOrderByOrdAsc(selected.stream().map(Scenario::getId).toList())
                .stream().collect(Collectors.groupingBy(TestCase::getScenarioId));
        int caseCount = createScenarioRuns(run, selected, casesByScenario);
        activities.record(project.getId(), run.code() + " 실행 시작 · " + request.code() + " 시나리오 " + selected.size()
                + "개, 케이스 " + caseCount + "개");
        submitAfterCommit(run.getId());
        return queries.view(run);
    }

    /**
     * operationId: rerunRun. 원래 실행이 끝나지 않았으면 409 RUN_NOT_FINISHED. caseResultIds 를 비우면 FAILED 케이스 전체,
     * 이 실행의 케이스가 아니거나 대상이 없으면 400, 대상 시나리오가 지금 APPROVED 가 아니면 409 SCENARIO_NOT_APPROVED,
     * 진행 중 실행이 있으면 409 RUN_ALREADY_ACTIVE. 케이스 version 이 그대로면 저장된 TestQuery·spec 을 다시 쓴다.
     */
    @Transactional
    public RunResponse rerun(UUID runId, List<UUID> caseResultIds) {
        TestRun original = runs.findById(runId).orElseThrow(() -> ApiException.notFound("실행"));
        if (!original.getStatus().isTerminal()) {
            throw new ApiException(ErrorCode.RUN_NOT_FINISHED, "실행이 끝난 뒤 재실행할 수 있습니다.");
        }
        Map<UUID, ScenarioRun> srById = scenarioRuns.findByRunIdOrderByOrdAsc(runId).stream()
                .collect(Collectors.toMap(ScenarioRun::getId, sr -> sr));
        List<CaseResult> runCases = srById.isEmpty() ? List.of()
                : caseResults.findByScenarioRunIdIn(new java.util.ArrayList<>(srById.keySet()));
        List<CaseResult> targets;
        if (caseResultIds == null || caseResultIds.isEmpty()) {
            targets = runCases.stream().filter(cr -> cr.getStatus() == CaseResultStatus.FAILED).toList();
            if (targets.isEmpty()) {
                throw ApiException.invalidField("caseResultIds", "재실행할 실패 케이스가 없습니다.");
            }
        } else {
            if (new HashSet<>(caseResultIds).size() != caseResultIds.size()) {
                throw ApiException.invalidField("caseResultIds", "같은 케이스를 두 번 넣을 수 없습니다.");
            }
            Map<UUID, CaseResult> byId = runCases.stream().collect(Collectors.toMap(CaseResult::getId, cr -> cr));
            targets = caseResultIds.stream().map(byId::get).toList();
            if (targets.contains(null)) {
                throw ApiException.invalidField("caseResultIds", "이 실행의 케이스가 아닌 항목이 있습니다.");
            }
        }
        List<TestCase> cases = testCases.findAllById(targets.stream().map(CaseResult::getTestCaseId).toList());
        if (cases.stream().anyMatch(tc -> !tc.isActive())) {
            throw ApiException.invalidField("caseResultIds", "재생성으로 대체된 케이스는 다시 실행할 수 없습니다.");
        }
        List<Scenario> selected = scenarios.findAllById(cases.stream().map(TestCase::getScenarioId).distinct().toList())
                .stream().sorted(Comparator.comparing(Scenario::getCode)).toList();
        List<String> notApproved = selected.stream().filter(s -> s.getStatus() != ScenarioStatus.APPROVED)
                .map(Scenario::getCode).toList();
        if (!notApproved.isEmpty()) {
            throw new ApiException(ErrorCode.SCENARIO_NOT_APPROVED,
                    "승인되지 않은 시나리오가 있어 재실행할 수 없습니다: " + String.join(", ", notApproved));
        }
        lockAndCheckActive();
        Project project = requireTarget(original.getProjectId());
        TestRun run = runs.saveAndFlush(TestRun.rerunOf(original, runs.findMaxSeq(project.getId()) + 1,
                project.getTargetUrl(), documentVersions(project.getId()), currentUser.currentUserId()));
        Map<UUID, List<TestCase>> casesByScenario = cases.stream()
                .sorted(Comparator.comparingInt(TestCase::getOrd))
                .collect(Collectors.groupingBy(TestCase::getScenarioId));
        int caseCount = createScenarioRuns(run, selected, casesByScenario);
        activities.record(project.getId(), run.code() + " 재실행 시작 · " + original.code() + "의 케이스 " + caseCount + "개");
        submitAfterCommit(run.getId());
        return queries.view(run);
    }

    private void lockAndCheckActive() {
        jdbc.query("select pg_advisory_xact_lock(" + ACTIVE_RUN_LOCK + ")", rs -> null);
        if (runs.existsByStatusIn(RunStatus.ACTIVE)) {
            throw new ApiException(ErrorCode.RUN_ALREADY_ACTIVE, "다른 실행이 진행 중입니다. 끝난 뒤 다시 실행해 주세요.");
        }
    }

    private Project requireTarget(UUID projectId) {
        Project project = projects.findByIdForUpdate(projectId).orElseThrow();
        if (project.getTargetUrl() == null || project.getTargetUrl().isBlank()) {
            throw new ApiException(ErrorCode.TARGET_URL_MISSING, "대상 사이트 URL을 먼저 입력해 주세요.");
        }
        return project;
    }

    private Map<String, Integer> documentVersions(UUID projectId) {
        Map<String, Integer> versions = new LinkedHashMap<>();
        documents.findByProjectIdAndActiveTrue(projectId).stream()
                .sorted(Comparator.comparing(Document::getType))
                .forEach(d -> versions.put(d.getType().name(), d.getVersion()));
        return versions;
    }

    private int createScenarioRuns(TestRun run, List<Scenario> ordered, Map<UUID, List<TestCase>> casesByScenario) {
        int ord = 1;
        int caseCount = 0;
        for (Scenario s : ordered) {
            ScenarioRun sr = scenarioRuns.save(new ScenarioRun(run.getId(), s.getId(), ord++));
            for (TestCase tc : casesByScenario.getOrDefault(s.getId(), List.of())) {
                caseResults.save(new CaseResult(sr.getId(), tc.getId()));
                caseCount++;
            }
        }
        return caseCount;
    }

    private void submitAfterCommit(UUID runId) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                worker.submit(runId);
            }
        });
    }

    /** operationId: cancelRun. PREPARING·RUNNING 에서 CANCELLING. 이미 끝났거나 CANCELLING 이면 409. */
    public RunResponse cancel(UUID runId) {
        TestRun run = tx.execute(status -> cancelInTx(runId));
        worker.requestCancel(runId);
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("status", run.getStatus());
        fields.put("progress", queries.progress(runId));
        events.publish(runId, RunEventType.RUN_STATUS, toMap(fields));
        return queries.view(run);
    }

    private TestRun cancelInTx(UUID runId) {
        TestRun run = runs.findByIdForUpdate(runId).orElseThrow(() -> ApiException.notFound("실행"));
        if (run.getStatus() != RunStatus.PREPARING && run.getStatus() != RunStatus.RUNNING) {
            throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION,
                    "진행 중인 실행만 중단할 수 있습니다 (현재 " + run.getStatus() + ").");
        }
        run.transitionTo(RunStatus.CANCELLING);
        activities.record(run.getProjectId(), run.code() + " 실행 중단 요청");
        return run;
    }

    private static Map<String, Object> toMap(Map<String, Object> fields) {
        Object progress = fields.get("progress");
        if (progress instanceof RunDtos.Progress p) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("totalScenarios", p.totalScenarios());
            m.put("finishedScenarios", p.finishedScenarios());
            m.put("passed", p.passed());
            m.put("failed", p.failed());
            m.put("error", p.error());
            m.put("skipped", p.skipped());
            m.put("cancelled", p.cancelled());
            m.put("running", p.running());
            m.put("waiting", p.waiting());
            fields.put("progress", m);
        }
        return fields;
    }
}
