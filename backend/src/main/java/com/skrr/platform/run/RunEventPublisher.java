package com.skrr.platform.run;

import com.skrr.platform.common.time.Times;
import com.skrr.platform.run.RunEnums.RunEventType;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * run_event 에 먼저 저장하고 SSE 로 보낸다(events.md). 저장을 먼저 해야 재연결 때 복구할 수 있다.
 * 상태 변경을 커밋한 뒤에 부른다.
 */
@Component
public class RunEventPublisher {

    private final RunEventRepository events;
    private final RunEventStreams streams;
    private final TransactionTemplate newTx;

    public RunEventPublisher(RunEventRepository events, RunEventStreams streams, PlatformTransactionManager tm) {
        this.events = events;
        this.streams = streams;
        this.newTx = new TransactionTemplate(tm);
        this.newTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public RunEvent publish(UUID runId, RunEventType type, Map<String, Object> fields) {
        Instant now = Times.now();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("runId", runId.toString());
        payload.put("occurredAt", now.toString());
        fields.forEach((k, v) -> {
            if (v != null) {
                payload.put(k, v instanceof Enum<?> e ? e.name() : v instanceof UUID u ? u.toString() : v);
            }
        });
        RunEvent saved = newTx.execute(status -> events.save(new RunEvent(runId, type.wireName(), payload, now)));
        streams.deliver(saved);
        return saved;
    }
}
