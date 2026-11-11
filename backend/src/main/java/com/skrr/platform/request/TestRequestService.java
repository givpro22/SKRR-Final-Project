package com.skrr.platform.request;

import com.skrr.platform.common.error.ApiException;
import com.skrr.platform.common.error.ErrorCode;
import com.skrr.platform.common.job.AsyncJob;
import com.skrr.platform.common.job.AsyncJobRepository;
import com.skrr.platform.common.job.JobType;
import com.skrr.platform.common.user.CurrentUserProvider;
import com.skrr.platform.knowledge.KnowledgeBaseRepository;
import com.skrr.platform.knowledge.KnowledgeBaseStatus;
import com.skrr.platform.project.ActivityService;
import com.skrr.platform.project.ProjectRepository;
import com.skrr.platform.request.TestRequestDtos.SelectionRequest;
import com.skrr.platform.request.TestRequestDtos.TestRequestPage;
import com.skrr.platform.request.TestRequestDtos.TestRequestResponse;
import com.skrr.platform.scenario.ScenarioRepository;
import com.skrr.platform.scenario.TestCaseRepository;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 자연어 테스트 요청과 후보 선택 (FR-02, UI-02-1, UI-02-1B). */
@Service
public class TestRequestService {

    public static final String JOB_SUBJECT = "TEST_REQUEST";
    public static final int MAX_TEXT_LENGTH = 500;

    private final TestRequestRepository requests;
    private final RequestCandidateRepository candidates;
    private final ProjectRepository projects;
    private final KnowledgeBaseRepository knowledgeBases;
    private final ScenarioRepository scenarios;
    private final TestCaseRepository testCases;
    private final AsyncJobRepository jobs;
    private final ActivityService activities;
    private final CurrentUserProvider currentUser;

    public TestRequestService(TestRequestRepository requests, RequestCandidateRepository candidates,
                              ProjectRepository projects, KnowledgeBaseRepository knowledgeBases,
                              ScenarioRepository scenarios, TestCaseRepository testCases, AsyncJobRepository jobs,
                              ActivityService activities, CurrentUserProvider currentUser) {
        this.requests = requests;
        this.candidates = candidates;
        this.projects = projects;
        this.knowledgeBases = knowledgeBases;
        this.scenarios = scenarios;
        this.testCases = testCases;
        this.jobs = jobs;
        this.activities = activities;
        this.currentUser = currentUser;
    }

    /**
     * operationId: createTestRequest. 지식 베이스가 READY 가 아니면(NOT_BUILT, BUILDING, STALE, FAILED) 409.
     * 정제는 async_job(REQUEST_REFINE)으로 남기고 스케줄러가 AI 서버에 보낸다.
     */
    @Transactional
    public TestRequestResponse create(UUID projectId, String rawText) {
        String text = normalizeText("text", rawText);
        projects.findByIdForUpdate(projectId).orElseThrow(() -> ApiException.notFound("프로젝트"));
        KnowledgeBaseStatus kbStatus = knowledgeBases.findById(projectId)
                .map(kb -> kb.getStatus())
                .orElse(KnowledgeBaseStatus.NOT_BUILT);
        if (kbStatus != KnowledgeBaseStatus.READY) {
            throw new ApiException(ErrorCode.KNOWLEDGE_BASE_NOT_READY, notReadyMessage(kbStatus));
        }
        int seq = requests.findMaxSeq(projectId) + 1;
        TestRequest request = requests.saveAndFlush(new TestRequest(projectId, seq, text, currentUser.currentUserId()));
        jobs.save(new AsyncJob(JobType.REQUEST_REFINE, JOB_SUBJECT, request.getId()));
        activities.record(projectId, request.code() + " 테스트 요청 생성: " + abbreviate(text, 60));
        return view(request);
    }

    @Transactional(readOnly = true)
    public TestRequestResponse get(UUID testRequestId) {
        return view(find(testRequestId));
    }

    /** operationId: listTestRequests. 최신 요청부터, cursor 는 다음 페이지의 기준 seq. */
    @Transactional(readOnly = true)
    public TestRequestPage list(UUID projectId, String cursor, int limit) {
        if (!projects.existsById(projectId)) {
            throw ApiException.notFound("프로젝트");
        }
        PageRequest page = PageRequest.of(0, limit + 1);
        List<TestRequest> found;
        if (cursor == null || cursor.isBlank()) {
            found = requests.findByProjectIdOrderBySeqDesc(projectId, page);
        } else {
            int before;
            try {
                before = Integer.parseInt(cursor);
            } catch (NumberFormatException ex) {
                throw ApiException.invalidField("cursor", "cursor 형식이 올바르지 않습니다");
            }
            found = requests.findByProjectIdAndSeqLessThanOrderBySeqDesc(projectId, before, page);
        }
        boolean more = found.size() > limit;
        List<TestRequest> pageItems = more ? found.subList(0, limit) : found;
        Map<UUID, List<RequestCandidate>> byRequest = candidates
                .findByTestRequestIdInOrderByOrdAsc(pageItems.stream().map(TestRequest::getId).toList()).stream()
                .collect(Collectors.groupingBy(RequestCandidate::getTestRequestId));
        List<TestRequestResponse> items = pageItems.stream()
                .map(r -> view(r, byRequest.getOrDefault(r.getId(), List.of())))
                .toList();
        String next = more ? String.valueOf(pageItems.get(pageItems.size() - 1).getSeq()) : null;
        return new TestRequestPage(items, next);
    }

    /**
     * operationId: selectRefinedRequest. AWAITING_SELECTION 에서만 받는다(아니면 409).
     * candidateId 와 customText 중 하나만, 후보는 이 요청의 것이어야 한다(아니면 400).
     */
    @Transactional
    public TestRequestResponse select(UUID testRequestId, SelectionRequest selection) {
        boolean hasCandidate = selection != null && selection.candidateId() != null;
        boolean hasCustom = selection != null && selection.customText() != null;
        if (hasCandidate == hasCustom) {
            throw ApiException.invalidField("candidateId", "candidateId와 customText 중 하나만 보내 주세요.");
        }
        TestRequest request = requests.findByIdForUpdate(testRequestId)
                .orElseThrow(() -> ApiException.notFound("테스트 요청"));
        String selectedText;
        SelectionSource source;
        if (hasCandidate) {
            RequestCandidate candidate = candidates.findById(selection.candidateId())
                    .filter(c -> c.getTestRequestId().equals(testRequestId))
                    .orElseThrow(() -> ApiException.invalidField("candidateId", "이 요청의 후보가 아닙니다."));
            request.select(SelectionSource.CANDIDATE, candidate.getRefinedText());
            candidate.markSelected();
            selectedText = candidate.getRefinedText();
            source = SelectionSource.CANDIDATE;
        } else {
            selectedText = normalizeText("customText", selection.customText());
            request.select(SelectionSource.CUSTOM, selectedText);
            source = SelectionSource.CUSTOM;
        }
        jobs.save(new AsyncJob(JobType.SCENARIO_GENERATE, JOB_SUBJECT, request.getId()));
        activities.record(request.getProjectId(), request.code() + (source == SelectionSource.CANDIDATE
                ? " 후보 선택, 시나리오 생성 시작" : " 직접 입력, 시나리오 생성 시작") + ": " + abbreviate(selectedText, 60));
        requests.flush();
        return view(request);
    }

    TestRequest find(UUID testRequestId) {
        return requests.findById(testRequestId).orElseThrow(() -> ApiException.notFound("테스트 요청"));
    }

    @Transactional(readOnly = true)
    public TestRequestResponse view(TestRequest request) {
        return view(request, candidates.findByTestRequestIdOrderByOrdAsc(request.getId()));
    }

    private TestRequestResponse view(TestRequest request, List<RequestCandidate> requestCandidates) {
        int scenarioCount = (int) scenarios.countByTestRequestId(request.getId());
        int caseCount = (int) testCases.countByTestRequestIdAndActiveTrue(request.getId());
        return TestRequestResponse.from(request, requestCandidates, scenarioCount, caseCount);
    }

    private static String normalizeText(String field, String raw) {
        String text = raw == null ? "" : raw.strip();
        if (text.isEmpty()) {
            throw ApiException.invalidField(field, "요청 내용을 입력해 주세요.");
        }
        if (text.length() > MAX_TEXT_LENGTH) {
            throw ApiException.invalidField(field, "요청은 " + MAX_TEXT_LENGTH + "자 이하로 입력해 주세요.");
        }
        return text;
    }

    private static String notReadyMessage(KnowledgeBaseStatus status) {
        return switch (status) {
            case STALE -> "기준 문서가 바뀌어 지식 베이스를 다시 구축해야 합니다. 구축 후 요청해 주세요.";
            case BUILDING -> "지식 베이스를 구축하고 있습니다. 구축이 끝난 뒤 요청해 주세요.";
            case FAILED -> "지식 베이스 구축이 실패했습니다. 문서를 확인하고 다시 구축해 주세요.";
            default -> "지식 베이스가 아직 없습니다. 기준 문서를 등록하고 지식 베이스를 구축해 주세요.";
        };
    }

    static String abbreviate(String text, int max) {
        return text.length() <= max ? text : text.substring(0, max) + "…";
    }
}
