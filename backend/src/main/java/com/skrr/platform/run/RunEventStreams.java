package com.skrr.platform.run;

import com.skrr.platform.common.time.Times;
import com.skrr.platform.run.RunEnums.RunEventType;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * 실행별 SSE 구독 관리 (WBS 4.3.6, events.md).
 * 구독 시 저장된 이벤트를 먼저 다시 보내고(재연결 복구), 그동안 들어온 실시간 이벤트는 모았다가 seq 순서로 이어 보낸다.
 * 이미 보낸 seq 이하는 보내지 않아 유실과 중복을 함께 막는다.
 */
@Component
public class RunEventStreams {

    /** 프록시 읽기 제한(3600초, docs/architecture.md)과 같게 둔다. 끊기면 브라우저가 Last-Event-ID 로 다시 붙는다. */
    static final long EMITTER_TIMEOUT_MS = 3_600_000L;

    private static final Logger log = LoggerFactory.getLogger(RunEventStreams.class);

    private final Map<UUID, Set<Subscriber>> byRun = new ConcurrentHashMap<>();
    private final RunEventRepository events;

    public RunEventStreams(RunEventRepository events) {
        this.events = events;
    }

    /**
     * afterSeq 이후 이벤트를 다시 보낸 뒤 실시간으로 넘어간다. runFinished 이고 남은 이벤트에 끝 상태가 없으면 바로 닫는다.
     */
    public SseEmitter subscribe(UUID runId, long afterSeq, boolean runFinished) {
        SseEmitter emitter = new SseEmitter(EMITTER_TIMEOUT_MS);
        Subscriber sub = new Subscriber(runId, emitter, afterSeq);
        Set<Subscriber> subs = byRun.computeIfAbsent(runId, id -> new CopyOnWriteArraySet<>());
        subs.add(sub);
        Runnable remove = () -> remove(sub);
        emitter.onCompletion(remove);
        emitter.onTimeout(() -> {
            remove.run();
            emitter.complete();
        });
        emitter.onError(e -> remove.run());

        List<RunEvent> replay = events.findByRunIdAndSeqGreaterThanOrderBySeqAsc(runId, afterSeq);
        sub.replay(replay);
        if (runFinished && !sub.closed) {
            sub.close();
        }
        return emitter;
    }

    public void deliver(RunEvent event) {
        Set<Subscriber> subs = byRun.get(event.getRunId());
        if (subs != null) {
            subs.forEach(sub -> sub.offer(event));
        }
    }

    int subscriberCount(UUID runId) {
        Set<Subscriber> subs = byRun.get(runId);
        return subs == null ? 0 : subs.size();
    }

    @Scheduled(fixedRateString = "${skrr.run.heartbeat-ms:15000}", initialDelayString = "${skrr.run.heartbeat-ms:15000}")
    public void heartbeat() {
        byRun.forEach((runId, subs) -> subs.forEach(Subscriber::heartbeat));
    }

    private void remove(Subscriber sub) {
        sub.closed = true;
        Set<Subscriber> subs = byRun.get(sub.runId);
        if (subs != null) {
            subs.remove(sub);
            if (subs.isEmpty()) {
                byRun.remove(sub.runId, subs);
            }
        }
    }

    static boolean isTerminalRunStatus(RunEvent event) {
        if (!RunEventType.RUN_STATUS.wireName().equals(event.getType())) {
            return false;
        }
        Object status = event.getPayload().get("status");
        try {
            return status != null && RunStatus.valueOf(status.toString()).isTerminal();
        } catch (IllegalArgumentException ex) {
            return false;
        }
    }

    private final class Subscriber {
        private final UUID runId;
        private final SseEmitter emitter;
        private long lastSent;
        private boolean replaying = true;
        private final List<RunEvent> buffer = new ArrayList<>();
        private volatile boolean closed;

        Subscriber(UUID runId, SseEmitter emitter, long afterSeq) {
            this.runId = runId;
            this.emitter = emitter;
            this.lastSent = afterSeq;
        }

        synchronized void replay(List<RunEvent> stored) {
            for (RunEvent e : stored) {
                send(e);
            }
            replaying = false;
            buffer.sort((a, b) -> Long.compare(a.getSeq(), b.getSeq()));
            for (RunEvent e : buffer) {
                send(e);
            }
            buffer.clear();
        }

        synchronized void offer(RunEvent event) {
            if (replaying) {
                buffer.add(event);
            } else {
                send(event);
            }
        }

        private void send(RunEvent e) {
            if (closed || e.getSeq() <= lastSent) {
                return;
            }
            try {
                emitter.send(SseEmitter.event().id(String.valueOf(e.getSeq())).name(e.getType())
                        .data(e.getPayload(), MediaType.APPLICATION_JSON));
                lastSent = e.getSeq();
                if (isTerminalRunStatus(e)) {
                    close();
                }
            } catch (IOException | IllegalStateException ex) {
                log.debug("SSE 전송 실패, 구독 해제: run={} {}", runId, ex.getMessage());
                closed = true;
                remove(this);
            }
        }

        synchronized void heartbeat() {
            if (closed || replaying) {
                return;
            }
            try {
                emitter.send(SseEmitter.event().name(RunEventType.HEARTBEAT.wireName())
                        .data(Map.of("runId", runId.toString(), "occurredAt", Times.now().toString()),
                                MediaType.APPLICATION_JSON));
            } catch (IOException | IllegalStateException ex) {
                closed = true;
                remove(this);
            }
        }

        void close() {
            closed = true;
            remove(this);
            emitter.complete();
        }
    }
}
