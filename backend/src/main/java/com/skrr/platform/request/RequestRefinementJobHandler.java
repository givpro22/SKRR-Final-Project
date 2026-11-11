package com.skrr.platform.request;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skrr.platform.client.ai.AiClient;
import com.skrr.platform.client.ai.AiJob;
import com.skrr.platform.client.ai.RefinementRequest;
import com.skrr.platform.client.ai.RefinementResult;
import com.skrr.platform.common.job.AiFailureMessages;
import com.skrr.platform.common.job.AsyncJob;
import com.skrr.platform.common.job.AsyncJobHandler;
import com.skrr.platform.common.job.InvalidJobResultException;
import com.skrr.platform.common.job.JobType;
import com.skrr.platform.project.ActivityService;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/** REQUEST_REFINE 작업 (FR-02). 자연어 요청을 RAG 근거로 후보 N개로 정제한다. */
@Component
public class RequestRefinementJobHandler implements AsyncJobHandler {

    static final int CANDIDATE_COUNT = 4;
    static final int TOP_K = 3;

    private static final Logger log = LoggerFactory.getLogger(RequestRefinementJobHandler.class);

    private final AiClient ai;
    private final TestRequestRepository requests;
    private final RequestCandidateRepository candidates;
    private final ActivityService activities;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate tx;

    public RequestRefinementJobHandler(AiClient ai, TestRequestRepository requests,
                                       RequestCandidateRepository candidates, ActivityService activities,
                                       ObjectMapper objectMapper, TransactionTemplate tx) {
        this.ai = ai;
        this.requests = requests;
        this.candidates = candidates;
        this.activities = activities;
        this.objectMapper = objectMapper;
        this.tx = tx;
    }

    @Override
    public JobType type() {
        return JobType.REQUEST_REFINE;
    }

    @Override
    public AiJob submit(AsyncJob job) {
        TestRequest request = tx.execute(status -> requests.findById(job.getSubjectId()).orElseThrow());
        return ai.startRequestRefinement(
                new RefinementRequest(request.getProjectId(), request.getRawText(), CANDIDATE_COUNT, TOP_K));
    }

    @Override
    public void onProgress(AsyncJob job, AiJob remote) {
        // 정제는 진행 표시가 없다 (UI-02-1 대기 화면)
    }

    @Override
    public void onSucceeded(AsyncJob job, AiJob remote) {
        List<RefinementResult.Candidate> result = parse(remote);
        Optional<TestRequest> maybe = requests.findByIdForUpdate(job.getSubjectId());
        if (maybe.isEmpty() || maybe.get().getStatus() != TestRequestStatus.REFINING) {
            log.warn("정제 중이 아닌 요청의 결과를 무시합니다: {}", job.getSubjectId());
            return;
        }
        TestRequest request = maybe.get();
        for (int i = 0; i < result.size(); i++) {
            RefinementResult.Candidate c = result.get(i);
            candidates.save(new RequestCandidate(request.getId(), i + 1, c.refinedText().strip(), c.references()));
        }
        request.candidatesReady();
        activities.record(request.getProjectId(), request.code() + " 요청 후보 " + result.size() + "개 준비");
    }

    @Override
    public void onFailed(AsyncJob job, String message) {
        onFailed(job, message, null);
    }

    @Override
    public void onFailed(AsyncJob job, String message, AiJob remote) {
        requests.findByIdForUpdate(job.getSubjectId())
                .filter(r -> r.getStatus() == TestRequestStatus.REFINING)
                .ifPresent(request -> {
                    String userMessage = AiFailureMessages.forUser(message, remote);
                    request.fail(userMessage);
                    activities.record(request.getProjectId(), request.code() + " 요청 정제 실패: " + userMessage);
                });
    }

    private List<RefinementResult.Candidate> parse(AiJob remote) {
        if (remote.result() == null || remote.result().isNull()) {
            throw new InvalidJobResultException("AI 정제 작업이 성공했지만 결과가 없습니다");
        }
        RefinementResult result;
        try {
            result = objectMapper.treeToValue(remote.result(), RefinementResult.class);
        } catch (JsonProcessingException | IllegalArgumentException ex) {
            throw new InvalidJobResultException("AI 정제 결과 형식이 계약과 다릅니다: " + ex.getMessage());
        }
        if (!"REQUEST_REFINE".equals(result.kind()) || result.candidates() == null) {
            throw new InvalidJobResultException("AI 정제 결과 형식이 계약과 다릅니다 (kind=" + result.kind() + ")");
        }
        if (result.candidates().isEmpty()) {
            throw new InvalidJobResultException("요청과 관련된 근거를 찾지 못해 후보를 만들지 못했습니다. 요청을 바꿔 다시 시도해 주세요.");
        }
        boolean malformed = result.candidates().stream().anyMatch(c -> c == null || c.refinedText() == null
                || c.refinedText().isBlank() || c.references() == null
                || c.references().stream().anyMatch(r -> r == null || r.sourceType() == null || r.sourceId() == null));
        if (malformed) {
            throw new InvalidJobResultException("AI 정제 결과 후보 형식이 계약과 다릅니다");
        }
        return result.candidates();
    }
}
