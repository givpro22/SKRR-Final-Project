package com.skrr.platform.report;

import com.skrr.platform.run.CaseResult;
import com.skrr.platform.run.CaseResultRepository;
import com.skrr.platform.run.RunStatus;
import com.skrr.platform.run.ScenarioRun;
import com.skrr.platform.run.ScenarioRunRepository;
import com.skrr.platform.run.TestRun;
import com.skrr.platform.run.TestRunRepository;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** 이전 실행 대비 (state-machines.md "이전 실행 대비"). 비교 대상과 케이스별 결과를 찾는다. */
@Component
@Transactional(readOnly = true)
public class RunComparisons {

    static final EnumSet<RunStatus> COMPARABLE = EnumSet.of(RunStatus.PASSED, RunStatus.FAILED, RunStatus.ERROR);

    private final TestRunRepository runs;
    private final ScenarioRunRepository scenarioRuns;
    private final CaseResultRepository caseResults;

    public RunComparisons(TestRunRepository runs, ScenarioRunRepository scenarioRuns,
                          CaseResultRepository caseResults) {
        this.runs = runs;
        this.scenarioRuns = scenarioRuns;
        this.caseResults = caseResults;
    }

    /** 재실행이면 원래 실행, 아니면 같은 요청에서 이 실행 전에 끝난(PASSED·FAILED·ERROR) 가장 최근 실행. */
    public Optional<TestRun> target(TestRun run) {
        if (run.getRerunOfRunId() != null) {
            return runs.findById(run.getRerunOfRunId());
        }
        return runs.findByTestRequestIdAndStatusInAndCreatedAtBeforeOrderByCreatedAtDesc(run.getTestRequestId(),
                COMPARABLE, run.getCreatedAt(), PageRequest.of(0, 1)).stream().findFirst();
    }

    /** test_case_id → case_result. */
    public Map<UUID, CaseResult> casesByTestCase(UUID runId) {
        List<UUID> srIds = scenarioRuns.findByRunIdOrderByOrdAsc(runId).stream().map(ScenarioRun::getId).toList();
        if (srIds.isEmpty()) {
            return Map.of();
        }
        return caseResults.findByScenarioRunIdIn(srIds).stream()
                .collect(Collectors.toMap(CaseResult::getTestCaseId, Function.identity(), (a, b) -> a));
    }
}
