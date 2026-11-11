package com.skrr.platform.run;

import com.skrr.platform.common.config.SkrrProperties;
import com.skrr.platform.common.error.ApiException;
import com.skrr.platform.common.user.AppUserRepository;
import com.skrr.platform.common.user.UserController.UserResponse;
import com.skrr.platform.document.storage.FileStorage;
import com.skrr.platform.project.ProjectRepository;
import com.skrr.platform.run.RunDtos.ApiCallPage;
import com.skrr.platform.run.RunDtos.ApiCallResponse;
import com.skrr.platform.run.RunDtos.CaseRunSummary;
import com.skrr.platform.run.RunDtos.GeneratedSpecResponse;
import com.skrr.platform.run.RunDtos.Progress;
import com.skrr.platform.run.RunDtos.RunDetailResponse;
import com.skrr.platform.run.RunDtos.RunLogEntry;
import com.skrr.platform.run.RunDtos.RunLogPage;
import com.skrr.platform.run.RunDtos.RunPage;
import com.skrr.platform.run.RunDtos.RunResponse;
import com.skrr.platform.run.RunDtos.RunStepResponse;
import com.skrr.platform.run.RunDtos.ScenarioRunResponse;
import com.skrr.platform.run.RunEnums.ArtifactType;
import com.skrr.platform.run.RunEnums.RunEventType;
import com.skrr.platform.run.RunEnums.StepKind;
import com.skrr.platform.scenario.Scenario;
import com.skrr.platform.scenario.ScenarioRepository;
import com.skrr.platform.scenario.TestCase;
import com.skrr.platform.scenario.TestCaseRepository;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 실행 조회 API (getRun, listRuns, listRunLogs, listRunApiCalls, getCaseResultSpec, getArtifactDownloadLink). */
@Service
@Transactional(readOnly = true)
public class RunQueryService {

    private final TestRunRepository runs;
    private final ScenarioRunRepository scenarioRuns;
    private final CaseResultRepository caseResults;
    private final RunStepRepository steps;
    private final RunEventRepository events;
    private final ApiCallRepository apiCalls;
    private final GeneratedSpecRepository specs;
    private final ArtifactRepository artifacts;
    private final ScenarioRepository scenarios;
    private final TestCaseRepository testCases;
    private final ProjectRepository projects;
    private final AppUserRepository users;
    private final FileStorage storage;
    private final SkrrProperties properties;

    public RunQueryService(TestRunRepository runs, ScenarioRunRepository scenarioRuns, CaseResultRepository caseResults,
                           RunStepRepository steps, RunEventRepository events, ApiCallRepository apiCalls,
                           GeneratedSpecRepository specs, ArtifactRepository artifacts, ScenarioRepository scenarios,
                           TestCaseRepository testCases, ProjectRepository projects, AppUserRepository users,
                           FileStorage storage, SkrrProperties properties) {
        this.runs = runs;
        this.scenarioRuns = scenarioRuns;
        this.caseResults = caseResults;
        this.steps = steps;
        this.events = events;
        this.apiCalls = apiCalls;
        this.specs = specs;
        this.artifacts = artifacts;
        this.scenarios = scenarios;
        this.testCases = testCases;
        this.projects = projects;
        this.users = users;
        this.storage = storage;
        this.properties = properties;
    }

    public TestRun find(UUID runId) {
        return runs.findById(runId).orElseThrow(() -> ApiException.notFound("실행"));
    }

    public RunResponse view(TestRun run) {
        return RunResponse.from(run, startedBy(run));
    }

    private UserResponse startedBy(TestRun run) {
        return run.getStartedBy() == null ? null
                : users.findById(run.getStartedBy()).map(UserResponse::from).orElse(null);
    }

    /** RunDetail.progress (시나리오 단위). */
    public Progress progress(UUID runId) {
        Map<ScenarioRunStatus, Long> counts = scenarioRuns.findByRunIdOrderByOrdAsc(runId).stream()
                .collect(Collectors.groupingBy(ScenarioRun::getStatus, Collectors.counting()));
        int passed = count(counts, ScenarioRunStatus.PASSED);
        int failed = count(counts, ScenarioRunStatus.FAILED);
        int error = count(counts, ScenarioRunStatus.ERROR);
        int skipped = count(counts, ScenarioRunStatus.SKIPPED);
        int cancelled = count(counts, ScenarioRunStatus.CANCELLED);
        int running = count(counts, ScenarioRunStatus.RUNNING);
        int waiting = count(counts, ScenarioRunStatus.WAITING);
        int finished = passed + failed + error + skipped + cancelled;
        return new Progress(finished + running + waiting, finished, passed, failed, error, skipped, cancelled, running,
                waiting);
    }

    private static int count(Map<ScenarioRunStatus, Long> counts, ScenarioRunStatus status) {
        return counts.getOrDefault(status, 0L).intValue();
    }

    /** operationId: getRun. 케이스 단계는 현재(마지막) 시도의 것만 싣는다. */
    public RunDetailResponse detail(UUID runId) {
        TestRun run = find(runId);
        List<ScenarioRun> srs = scenarioRuns.findByRunIdOrderByOrdAsc(runId);
        Map<UUID, Scenario> scenarioById = scenarios.findAllById(srs.stream().map(ScenarioRun::getScenarioId).toList())
                .stream().collect(Collectors.toMap(Scenario::getId, Function.identity()));
        List<CaseResult> crs = srs.isEmpty() ? List.of()
                : caseResults.findByScenarioRunIdIn(srs.stream().map(ScenarioRun::getId).toList());
        Map<UUID, TestCase> caseById = testCases.findAllById(crs.stream().map(CaseResult::getTestCaseId).toList())
                .stream().collect(Collectors.toMap(TestCase::getId, Function.identity()));
        Map<UUID, List<RunStep>> stepsByCase = crs.isEmpty() ? Map.of()
                : steps.findByCaseResultIdInOrderByAttemptAscOrdAsc(crs.stream().map(CaseResult::getId).toList())
                        .stream().collect(Collectors.groupingBy(RunStep::getCaseResultId));
        Map<UUID, List<CaseResult>> casesByScenarioRun = crs.stream()
                .collect(Collectors.groupingBy(CaseResult::getScenarioRunId));

        List<ScenarioRunResponse> items = srs.stream().map(sr -> {
            Scenario scenario = scenarioById.get(sr.getScenarioId());
            List<CaseRunSummary> cases = casesByScenarioRun.getOrDefault(sr.getId(), List.of()).stream()
                    .sorted(Comparator.comparingInt(cr -> caseById.get(cr.getTestCaseId()).getOrd()))
                    .map(cr -> caseSummary(cr, caseById.get(cr.getTestCaseId()),
                            stepsByCase.getOrDefault(cr.getId(), List.of())))
                    .toList();
            return new ScenarioRunResponse(sr.getId(), sr.getScenarioId(), scenario.getCode(), scenario.getTitle(),
                    scenario.getRequirementRef(), sr.getOrd(), sr.getStatus(), sr.getDurationMs(), cases);
        }).toList();

        Optional<Artifact> screenshot = artifacts.findFirstByRunIdAndTypeOrderByCreatedAtDesc(runId,
                ArtifactType.SCREENSHOT);
        UserResponse startedBy = startedBy(run);
        return new RunDetailResponse(run.getId(), run.code(), run.getProjectId(), run.getTestRequestId(),
                run.getRerunOfRunId(), run.getStatus(), run.getTargetUrl(), run.getTargetBuild(), run.getBrowser(),
                run.getViewportWidth(), run.getViewportHeight(), run.getDocumentVersions(), startedBy,
                run.getErrorMessage(), run.getCreatedAt(), run.getStartedAt(), run.getFinishedAt(), progress(runId),
                items, screenshot.map(Artifact::getId).orElse(null), screenshot.map(Artifact::getLabel).orElse(null),
                events.findLastSeq(runId));
    }

    private static CaseRunSummary caseSummary(CaseResult cr, TestCase tc, List<RunStep> allSteps) {
        int lastAttempt = allSteps.stream().mapToInt(RunStep::getAttempt).max().orElse(0);
        List<RunStepResponse> current = allSteps.stream().filter(s -> s.getAttempt() == lastAttempt)
                .map(RunStepResponse::from).toList();
        return new CaseRunSummary(cr.getId(), cr.getTestCaseId(), tc.getCode(), tc.getTitle(), cr.getStatus(),
                cr.getAttempts(), cr.getFailedAttempts(), cr.getDurationMs(), current);
    }

    /** operationId: listRuns. 최신순, cursor 는 다음 페이지 기준 seq. */
    public RunPage list(UUID projectId, String cursor, int limit) {
        if (!projects.existsById(projectId)) {
            throw ApiException.notFound("프로젝트");
        }
        PageRequest page = PageRequest.of(0, limit + 1);
        List<TestRun> found = cursor == null || cursor.isBlank()
                ? runs.findByProjectIdOrderBySeqDesc(projectId, page)
                : runs.findByProjectIdAndSeqLessThanOrderBySeqDesc(projectId, parseCursor(cursor), page);
        boolean more = found.size() > limit;
        List<TestRun> items = more ? found.subList(0, limit) : found;
        return new RunPage(items.stream().map(this::view).toList(),
                more ? String.valueOf(items.get(items.size() - 1).getSeq()) : null);
    }

    /** operationId: listRunLogs. run_event 의 log 이벤트. */
    public RunLogPage logs(UUID runId, long afterSeq, int limit) {
        find(runId);
        List<RunEvent> found = events.findByRunIdAndTypeAndSeqGreaterThanOrderBySeqAsc(runId,
                RunEventType.LOG.wireName(), afterSeq, PageRequest.of(0, limit + 1));
        boolean more = found.size() > limit;
        List<RunEvent> items = more ? found.subList(0, limit) : found;
        List<RunLogEntry> entries = items.stream().map(e -> new RunLogEntry(e.getSeq(),
                stepKind(e.getPayload().get("kind")), String.valueOf(e.getPayload().getOrDefault("message", "")),
                e.getCreatedAt())).toList();
        return new RunLogPage(entries, more ? items.get(items.size() - 1).getSeq() : null);
    }

    private static StepKind stepKind(Object value) {
        try {
            return value == null ? StepKind.SETUP : StepKind.valueOf(value.toString());
        } catch (IllegalArgumentException ex) {
            return StepKind.SETUP;
        }
    }

    /** operationId: listRunApiCalls. cursor 는 마지막 호출 id. */
    public ApiCallPage apiCalls(UUID runId, String cursor, int limit) {
        find(runId);
        long after = cursor == null || cursor.isBlank() ? 0 : parseCursor(cursor);
        List<ApiCallEntry> found = apiCalls.findByRunIdAndIdGreaterThanOrderByIdAsc(runId, after,
                PageRequest.of(0, limit + 1));
        boolean more = found.size() > limit;
        List<ApiCallEntry> items = more ? found.subList(0, limit) : found;
        Double average = apiCalls.averageDuration(runId);
        return new ApiCallPage(items.stream().map(ApiCallResponse::from).toList(), apiCalls.countByRunId(runId),
                average == null ? null : (int) Math.round(average),
                more ? String.valueOf(items.get(items.size() - 1).getId()) : null);
    }

    /** operationId: getCaseResultSpec. 생성·변환 전이거나 실패했으면 404. 비밀값은 들어 있지 않다. */
    public GeneratedSpecResponse spec(UUID caseResultId) {
        CaseResult cr = caseResults.findById(caseResultId).orElseThrow(() -> ApiException.notFound("케이스 결과"));
        if (cr.getGeneratedSpecId() == null) {
            throw ApiException.notFound("spec");
        }
        GeneratedSpec spec = specs.findById(cr.getGeneratedSpecId()).orElseThrow(() -> ApiException.notFound("spec"));
        TestCase tc = testCases.findById(cr.getTestCaseId()).orElseThrow();
        return new GeneratedSpecResponse(tc.getCode(), specFileName(tc.getCode()), spec.getSpecSource(),
                spec.getRendererVersion(), spec.getCompileStatus(), spec.getCompileError());
    }

    static String specFileName(String caseCode) {
        return caseCode.toLowerCase() + ".spec.ts";
    }

    /** operationId: getArtifactDownloadLink. */
    public FileStorage.PresignedLink artifactLink(UUID artifactId) {
        Artifact artifact = artifacts.findById(artifactId).orElseThrow(() -> ApiException.notFound("실행 증거"));
        String key = artifact.getStorageKey();
        String name = key.substring(key.lastIndexOf('/') + 1);
        return storage.presignDownload(key, name, properties.storage().presignTtl());
    }

    private static int parseCursor(String cursor) {
        try {
            return Integer.parseInt(cursor);
        } catch (NumberFormatException ex) {
            throw ApiException.invalidField("cursor", "cursor 형식이 올바르지 않습니다");
        }
    }

    static Instant now() {
        return Instant.now();
    }
}
