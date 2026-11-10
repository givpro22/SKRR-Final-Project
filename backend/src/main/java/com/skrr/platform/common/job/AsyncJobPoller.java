package com.skrr.platform.common.job;

import com.skrr.platform.client.ai.AiClient;
import com.skrr.platform.client.ai.AiJob;
import com.skrr.platform.client.ai.AiJobNotFoundException;
import com.skrr.platform.client.ai.AiRequestRejectedException;
import com.skrr.platform.client.ai.AiUnavailableException;
import com.skrr.platform.common.config.SkrrProperties;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 열린 async_job 을 한 번씩 진행시킨다. 스케줄러가 주기적으로 부르며, 앱이 재시작되어도 DB의 열린 작업을 이어서 처리한다.
 * <ul>
 *   <li>원격 ID가 없으면 AI 서버에 보낸다 (연결 오류는 AiClient 가 짧게 재시도).</li>
 *   <li>조회 404는 AI 서버 재시작으로 작업을 잃은 것이므로 1회 다시 보내고, 또 실패하면 FAILED.</li>
 *   <li>AI 작업 실패는 error.retryable 이 true 일 때만 1회 다시 보낸다.</li>
 * </ul>
 */
@Component
public class AsyncJobPoller {

    /** 처음 1회 + 다시 보내기 1회. */
    static final int MAX_SUBMISSIONS = 2;

    private static final Logger log = LoggerFactory.getLogger(AsyncJobPoller.class);

    private final AsyncJobRepository jobs;
    private final AiClient ai;
    private final Map<JobType, AsyncJobHandler> handlers;
    private final TransactionTemplate tx;
    private final int maxConsecutivePollErrors;
    private final Map<UUID, Integer> pollErrors = new ConcurrentHashMap<>();

    public AsyncJobPoller(AsyncJobRepository jobs, AiClient ai, List<AsyncJobHandler> handlers,
                          TransactionTemplate tx, SkrrProperties properties) {
        this.jobs = jobs;
        this.ai = ai;
        this.handlers = handlers.stream().collect(Collectors.toMap(AsyncJobHandler::type, Function.identity()));
        this.tx = tx;
        this.maxConsecutivePollErrors = properties.jobs().maxConsecutivePollErrors();
    }

    public synchronized void pollOnce() {
        List<UUID> openJobIds = tx.execute(status -> jobs
                .findByStatusInOrderByCreatedAtAsc(EnumSet.of(JobStatus.QUEUED, JobStatus.RUNNING))
                .stream().map(AsyncJob::getId).toList());
        if (openJobIds == null) {
            return;
        }
        for (UUID jobId : openJobIds) {
            try {
                advance(jobId);
            } catch (RuntimeException ex) {
                log.error("비동기 작업 처리 중 오류: jobId={}", jobId, ex);
            }
        }
    }

    void advance(UUID jobId) {
        AsyncJob snapshot = tx.execute(status -> jobs.findById(jobId).orElse(null));
        if (snapshot == null || !snapshot.getStatus().isOpen()) {
            return;
        }
        AsyncJobHandler handler = handlers.get(snapshot.getType());
        if (handler == null) {
            return;
        }
        if (snapshot.getRemoteJobId() == null) {
            submit(snapshot, handler);
        } else {
            poll(snapshot, handler);
        }
    }

    private void submit(AsyncJob snapshot, AsyncJobHandler handler) {
        AiJob remote;
        try {
            remote = handler.submit(snapshot);
        } catch (AiUnavailableException | AiRequestRejectedException ex) {
            finishFailed(snapshot.getId(), handler, "AI 서버에 작업을 요청하지 못했습니다: " + ex.getMessage());
            return;
        }
        inLockedJob(snapshot.getId(), job -> {
            job.submitted(remote.jobId());
            applyRemote(job, handler, remote);
        });
    }

    private void poll(AsyncJob snapshot, AsyncJobHandler handler) {
        AiJob remote;
        try {
            remote = ai.getJob(snapshot.getRemoteJobId());
        } catch (AiJobNotFoundException ex) {
            pollErrors.remove(snapshot.getId());
            inLockedJob(snapshot.getId(), job -> retryOrFail(job, handler,
                    "AI 서버에서 작업을 찾을 수 없습니다 (서버 재시작으로 유실)", null));
            return;
        } catch (AiUnavailableException | AiRequestRejectedException ex) {
            int errors = pollErrors.merge(snapshot.getId(), 1, Integer::sum);
            log.warn("AI 작업 조회 실패 {}/{}: {}", errors, maxConsecutivePollErrors, ex.getMessage());
            if (errors >= maxConsecutivePollErrors) {
                pollErrors.remove(snapshot.getId());
                finishFailed(snapshot.getId(), handler, "AI 서버 응답이 없어 작업을 끝내지 못했습니다: " + ex.getMessage());
            }
            return;
        }
        pollErrors.remove(snapshot.getId());
        inLockedJob(snapshot.getId(), job -> applyRemote(job, handler, remote));
    }

    private void applyRemote(AsyncJob job, AsyncJobHandler handler, AiJob remote) {
        switch (remote.status()) {
            case "QUEUED", "RUNNING" -> handler.onProgress(job, remote);
            case "SUCCEEDED" -> {
                try {
                    handler.onSucceeded(job, remote);
                    job.succeed();
                } catch (InvalidJobResultException ex) {
                    job.fail(ex.getMessage());
                    handler.onFailed(job, ex.getMessage());
                }
            }
            case "FAILED" -> {
                AiJob.Error error = remote.error();
                String message = error == null ? "AI 작업이 실패했습니다"
                        : "AI 작업 실패 (" + error.code() + "): " + error.message();
                if (error != null && Boolean.TRUE.equals(error.retryable())) {
                    retryOrFail(job, handler, message, remote);
                } else {
                    job.fail(message);
                    handler.onFailed(job, message, remote);
                }
            }
            case "CANCELLED" -> {
                job.cancel("AI 서버에서 작업이 취소되었습니다");
                handler.onFailed(job, "AI 서버에서 작업이 취소되었습니다");
            }
            default -> log.warn("알 수 없는 AI 작업 상태: {}", remote.status());
        }
    }

    private void retryOrFail(AsyncJob job, AsyncJobHandler handler, String reason, AiJob remote) {
        if (job.getAttempt() < MAX_SUBMISSIONS) {
            log.info("AI 작업 다시 요청: jobId={}, 사유={}", job.getId(), reason);
            job.requeue();
        } else {
            job.fail(reason);
            handler.onFailed(job, reason, remote);
        }
    }

    private void finishFailed(UUID jobId, AsyncJobHandler handler, String message) {
        inLockedJob(jobId, job -> {
            job.fail(message);
            handler.onFailed(job, message);
        });
    }

    private void inLockedJob(UUID jobId, Consumer<AsyncJob> action) {
        tx.executeWithoutResult(status -> jobs.findByIdForUpdate(jobId)
                .filter(job -> job.getStatus().isOpen())
                .ifPresent(action));
    }
}
