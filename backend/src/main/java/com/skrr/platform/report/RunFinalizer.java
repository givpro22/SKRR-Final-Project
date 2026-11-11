package com.skrr.platform.report;

import com.skrr.platform.common.job.AsyncJob;
import com.skrr.platform.common.job.AsyncJobRepository;
import com.skrr.platform.common.job.JobType;
import com.skrr.platform.run.CaseResult;
import com.skrr.platform.run.CaseResultStatus;
import com.skrr.platform.run.RunEnums.StepStatus;
import com.skrr.platform.run.RunEnums.Verdict;
import com.skrr.platform.run.RunStep;
import com.skrr.platform.run.RunStepRepository;
import com.skrr.platform.run.TestRun;
import com.skrr.platform.run.TestRunRepository;
import com.skrr.platform.run.Verification;
import com.skrr.platform.run.VerificationRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 실행이 끝난 뒤의 마무리: 실패 지문(failure_fingerprint)과 처음 발생 실행(first_seen_run_id)을 계산하고,
 * FAILED 케이스마다 실패 원인 분석 작업(FAILURE_ANALYZE)을 만든다. 분석은 리포트를 기다리게 하지 않는다.
 */
@Component
public class RunFinalizer {

    public static final String JOB_SUBJECT = "CASE_RESULT";

    private final TestRunRepository runs;
    private final RunComparisons comparisons;
    private final RunStepRepository steps;
    private final VerificationRepository verifications;
    private final AsyncJobRepository jobs;

    public RunFinalizer(TestRunRepository runs, RunComparisons comparisons, RunStepRepository steps,
                        VerificationRepository verifications, AsyncJobRepository jobs) {
        this.runs = runs;
        this.comparisons = comparisons;
        this.steps = steps;
        this.verifications = verifications;
        this.jobs = jobs;
    }

    @Transactional
    public int finish(UUID runId) {
        TestRun run = runs.findById(runId).orElseThrow();
        Optional<TestRun> previous = comparisons.target(run);
        Map<UUID, CaseResult> previousCases = previous.map(p -> comparisons.casesByTestCase(p.getId())).orElse(Map.of());
        int analyses = 0;
        for (CaseResult cr : comparisons.casesByTestCase(runId).values()) {
            if (cr.getStatus() != CaseResultStatus.FAILED) {
                continue;
            }
            String fingerprint = fingerprint(cr);
            CaseResult before = previousCases.get(cr.getTestCaseId());
            UUID firstSeen = runId;
            // 지문이 없는 이전 실행(M4 전에 끝남)은 저장된 단계·검증으로 지금 계산해 비교한다
            String beforeFingerprint = before == null || before.getStatus() != CaseResultStatus.FAILED ? null
                    : before.getFailureFingerprint() != null ? before.getFailureFingerprint() : fingerprint(before);
            if (fingerprint.equals(beforeFingerprint)) {
                firstSeen = before.getFirstSeenRunId() != null ? before.getFirstSeenRunId() : previous.get().getId();
            }
            cr.recordFingerprint(fingerprint, firstSeen);
            cr.requestAnalysis();
            jobs.save(new AsyncJob(JobType.FAILURE_ANALYZE, JOB_SUBJECT, cr.getId()));
            analyses++;
        }
        return analyses;
    }

    /** (케이스, 실패 유형, 실패 단계, 기대·실제 값, 불일치 항목)의 SHA-256. 같은 실패가 반복되는지 판별한다. */
    String fingerprint(CaseResult cr) {
        List<RunStep> all = steps.findByCaseResultIdOrderByAttemptAscOrdAsc(cr.getId());
        Optional<RunStep> failedStep = all.stream().filter(s -> s.getStatus() == StepStatus.FAILED)
                .max(Comparator.comparingInt(RunStep::getAttempt).thenComparing(s -> -s.getOrd()));
        String mismatches = verifications.findByCaseResultIdOrderByOrdAsc(cr.getId()).stream()
                .filter(v -> v.getVerdict() == Verdict.MISMATCH).map(Verification::getItemLabel)
                .sorted().collect(Collectors.joining(","));
        String key = String.join("|", cr.getTestCaseId().toString(),
                String.valueOf(cr.getFailureType()),
                failedStep.map(s -> s.getKind() + ":" + s.getTitle()).orElse("-"),
                failedStep.map(RunStep::getExpectedValue).orElse("-"),
                failedStep.map(RunStep::getActualValue).orElse("-"),
                mismatches);
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(key.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
