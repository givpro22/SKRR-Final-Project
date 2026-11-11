package com.skrr.platform.run;

import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 백엔드가 재시작되면 진행 중이던 실행은 이어서 할 수 없다(실행기 연결·작업자 상태가 메모리에 있음).
 * 시작할 때 남은 실행을 ERROR(중단 요청 중이면 CANCELLED)로 끝내 플랫폼 전체 1개 규칙(U3)이 막히지 않게 한다.
 */
@Component
public class RunRecovery {

    private static final Logger log = LoggerFactory.getLogger(RunRecovery.class);

    private final TestRunRepository runs;
    private final RunStore store;
    private final RunEventPublisher events;

    public RunRecovery(TestRunRepository runs, RunStore store, RunEventPublisher events) {
        this.runs = runs;
        this.store = store;
        this.events = events;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void closeInterruptedRuns() {
        List<TestRun> open = runs.findByStatusIn(RunStatus.ACTIVE);
        for (TestRun run : open) {
            try {
                boolean cancelling = run.getStatus() == RunStatus.CANCELLING;
                store.closeRemaining(run.getId(), cancelling);
                RunStatus end = store.finishRun(run.getId(), RunStatus.ERROR, "백엔드가 재시작되어 실행이 중단되었습니다");
                events.publish(run.getId(), RunEnums.RunEventType.RUN_STATUS,
                        java.util.Map.of("status", end, "errorMessage", "백엔드가 재시작되어 실행이 중단되었습니다"));
                log.warn("재시작 전 실행 {} 을(를) {} 로 끝냈습니다", run.code(), end);
            } catch (RuntimeException ex) {
                log.error("중단된 실행 정리 실패: {}", run.getId(), ex);
            }
        }
    }
}
