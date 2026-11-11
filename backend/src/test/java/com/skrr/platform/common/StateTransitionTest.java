package com.skrr.platform.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.skrr.platform.common.error.ErrorCode;
import com.skrr.platform.common.error.InvalidStateTransitionException;
import com.skrr.platform.document.Document;
import com.skrr.platform.document.DocumentStatus;
import com.skrr.platform.document.DocumentType;
import com.skrr.platform.knowledge.KnowledgeBase;
import com.skrr.platform.knowledge.KnowledgeBaseStatus;
import com.skrr.platform.request.TestRequestStatus;
import com.skrr.platform.run.CaseResultStatus;
import com.skrr.platform.run.RunStatus;
import com.skrr.platform.run.ScenarioRunStatus;
import com.skrr.platform.scenario.GuardFailureKind;
import com.skrr.platform.scenario.JsonValues;
import com.skrr.platform.scenario.Scenario;
import com.skrr.platform.scenario.ScenarioStatus;
import com.skrr.platform.scenario.VerificationScope;
import java.util.List;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/** docs/contracts/state-machines.md 의 Document, KnowledgeBase 표를 허용·거부 모두 확인한다. */
class StateTransitionTest {

    private static final Map<DocumentStatus, Set<DocumentStatus>> DOCUMENT_TABLE = Map.of(
            DocumentStatus.UPLOADED, EnumSet.of(DocumentStatus.INDEXING, DocumentStatus.REGISTERED),
            DocumentStatus.INDEXING, EnumSet.of(DocumentStatus.INDEXED, DocumentStatus.FAILED,
                    DocumentStatus.SKIPPED),
            DocumentStatus.FAILED, EnumSet.of(DocumentStatus.INDEXING),
            DocumentStatus.SKIPPED, EnumSet.of(DocumentStatus.INDEXING),
            DocumentStatus.INDEXED, EnumSet.of(DocumentStatus.INDEXING),
            DocumentStatus.REGISTERED, EnumSet.noneOf(DocumentStatus.class));

    private static final Map<KnowledgeBaseStatus, Set<KnowledgeBaseStatus>> KB_TABLE = Map.of(
            KnowledgeBaseStatus.NOT_BUILT, EnumSet.of(KnowledgeBaseStatus.BUILDING),
            KnowledgeBaseStatus.BUILDING, EnumSet.of(KnowledgeBaseStatus.READY, KnowledgeBaseStatus.FAILED),
            KnowledgeBaseStatus.READY, EnumSet.of(KnowledgeBaseStatus.STALE),
            KnowledgeBaseStatus.STALE, EnumSet.of(KnowledgeBaseStatus.BUILDING),
            KnowledgeBaseStatus.FAILED, EnumSet.of(KnowledgeBaseStatus.BUILDING));

    private static final Map<TestRequestStatus, Set<TestRequestStatus>> REQUEST_TABLE = Map.of(
            TestRequestStatus.REFINING, EnumSet.of(TestRequestStatus.AWAITING_SELECTION, TestRequestStatus.FAILED),
            TestRequestStatus.AWAITING_SELECTION, EnumSet.of(TestRequestStatus.GENERATING),
            TestRequestStatus.GENERATING, EnumSet.of(TestRequestStatus.GENERATED, TestRequestStatus.FAILED),
            TestRequestStatus.GENERATED, EnumSet.noneOf(TestRequestStatus.class),
            TestRequestStatus.FAILED, EnumSet.noneOf(TestRequestStatus.class));

    /** 그림의 전이 + 동작 표(수정은 REJECTED·GUARD_FAILED 에서도 REVIEW_REQUIRED). */
    private static final Map<ScenarioStatus, Set<ScenarioStatus>> SCENARIO_TABLE = Map.of(
            ScenarioStatus.GENERATING, EnumSet.of(ScenarioStatus.GUARD_RETRY, ScenarioStatus.REVIEW_REQUIRED),
            ScenarioStatus.GUARD_RETRY, EnumSet.of(ScenarioStatus.GENERATING, ScenarioStatus.GUARD_FAILED),
            ScenarioStatus.REVIEW_REQUIRED, EnumSet.of(ScenarioStatus.APPROVED, ScenarioStatus.REJECTED,
                    ScenarioStatus.GENERATING),
            ScenarioStatus.APPROVED, EnumSet.of(ScenarioStatus.REVIEW_REQUIRED, ScenarioStatus.GENERATING),
            ScenarioStatus.REJECTED, EnumSet.of(ScenarioStatus.GENERATING, ScenarioStatus.REVIEW_REQUIRED),
            ScenarioStatus.GUARD_FAILED, EnumSet.of(ScenarioStatus.GENERATING, ScenarioStatus.REVIEW_REQUIRED));

    @ParameterizedTest
    @EnumSource(TestRequestStatus.class)
    void testRequestTransitionsMatchContract(TestRequestStatus from) {
        for (TestRequestStatus to : TestRequestStatus.values()) {
            assertThat(from.canTransitionTo(to)).as("%s → %s", from, to).isEqualTo(REQUEST_TABLE.get(from).contains(to));
        }
    }

    @ParameterizedTest
    @EnumSource(ScenarioStatus.class)
    void scenarioTransitionsMatchContract(ScenarioStatus from) {
        for (ScenarioStatus to : ScenarioStatus.values()) {
            assertThat(from.canTransitionTo(to)).as("%s → %s", from, to).isEqualTo(SCENARIO_TABLE.get(from).contains(to));
        }
    }

    private static final Map<RunStatus, Set<RunStatus>> RUN_TABLE = Map.of(
            RunStatus.PREPARING, EnumSet.of(RunStatus.RUNNING, RunStatus.CANCELLING, RunStatus.ERROR),
            RunStatus.RUNNING, EnumSet.of(RunStatus.PASSED, RunStatus.FAILED, RunStatus.ERROR, RunStatus.CANCELLING),
            RunStatus.CANCELLING, EnumSet.of(RunStatus.CANCELLED),
            RunStatus.PASSED, EnumSet.noneOf(RunStatus.class),
            RunStatus.FAILED, EnumSet.noneOf(RunStatus.class),
            RunStatus.CANCELLED, EnumSet.noneOf(RunStatus.class),
            RunStatus.ERROR, EnumSet.noneOf(RunStatus.class));

    @ParameterizedTest
    @EnumSource(RunStatus.class)
    void runTransitionsMatchContract(RunStatus from) {
        for (RunStatus to : RunStatus.values()) {
            assertThat(from.allowedNext().contains(to)).as("%s → %s", from, to).isEqualTo(RUN_TABLE.get(from).contains(to));
        }
    }

    @Test
    void scenarioRunAndCaseResultTransitions() {
        assertThat(ScenarioRunStatus.WAITING.allowedNext()).containsExactlyInAnyOrder(ScenarioRunStatus.RUNNING,
                ScenarioRunStatus.SKIPPED, ScenarioRunStatus.CANCELLED);
        assertThat(ScenarioRunStatus.RUNNING.allowedNext()).containsExactlyInAnyOrder(ScenarioRunStatus.PASSED,
                ScenarioRunStatus.FAILED, ScenarioRunStatus.ERROR, ScenarioRunStatus.CANCELLED);
        assertThat(CaseResultStatus.PENDING.allowedNext()).containsExactlyInAnyOrder(CaseResultStatus.RUNNING,
                CaseResultStatus.SKIPPED, CaseResultStatus.CANCELLED);
        assertThat(CaseResultStatus.RUNNING.allowedNext()).containsExactlyInAnyOrder(CaseResultStatus.PASSED,
                CaseResultStatus.FAILED, CaseResultStatus.ERROR, CaseResultStatus.CANCELLED);
        for (CaseResultStatus s : CaseResultStatus.values()) {
            if (s.isTerminal()) {
                assertThat(s.allowedNext()).isEmpty();
            }
        }
    }

    @Test
    void scenarioActionsFollowActionTable() {
        assertThat(ScenarioStatus.EDITABLE).containsExactlyInAnyOrder(ScenarioStatus.REVIEW_REQUIRED,
                ScenarioStatus.APPROVED, ScenarioStatus.REJECTED, ScenarioStatus.GUARD_FAILED);
        Scenario scenario = new Scenario(UUID.randomUUID(), "SC-01",
                new Scenario.Content("t", null, List.of(VerificationScope.UI), List.of()),
                new Scenario.Guard(true, 1, List.of()));
        assertThat(scenario.getStatus()).isEqualTo(ScenarioStatus.REVIEW_REQUIRED);
        scenario.approve(UUID.randomUUID(), java.time.Instant.now());
        assertThat(scenario.getApprovedAt()).isNotNull();
        scenario.startRegeneration();
        assertThat(scenario.getApprovedAt()).isNull();
        assertThatThrownBy(scenario::startRegeneration).isInstanceOf(InvalidStateTransitionException.class);
        assertThatThrownBy(scenario::reject).isInstanceOf(InvalidStateTransitionException.class);
        scenario.regenerationProgress(2, "가드 실패");
        assertThat(scenario.getStatus()).isEqualTo(ScenarioStatus.GUARD_RETRY);
        scenario.regenerated(new Scenario.Content("t2", null, List.of(), List.of()),
                new Scenario.Guard(true, 2, List.of()));
        assertThat(scenario.getStatus()).isEqualTo(ScenarioStatus.REVIEW_REQUIRED);
        assertThat(scenario.getVersion()).isEqualTo(2);

        Scenario failed = new Scenario(UUID.randomUUID(), "SC-02",
                new Scenario.Content("t", null, List.of(), List.of()),
                new Scenario.Guard(false, 3, List.of(new JsonValues.GuardFailure(GuardFailureKind.CATALOG_GAP, "m", "x"))));
        assertThat(failed.getStatus()).isEqualTo(ScenarioStatus.GUARD_FAILED);
        assertThat(failed.catalogGap()).isTrue();
        assertThatThrownBy(() -> failed.approve(UUID.randomUUID(), java.time.Instant.now()))
                .isInstanceOf(InvalidStateTransitionException.class);
    }

    @ParameterizedTest
    @EnumSource(DocumentStatus.class)
    void documentTransitionsMatchContract(DocumentStatus from) {
        for (DocumentStatus to : DocumentStatus.values()) {
            assertThat(from.canTransitionTo(to))
                    .as("%s → %s", from, to)
                    .isEqualTo(DOCUMENT_TABLE.get(from).contains(to));
        }
    }

    @ParameterizedTest
    @EnumSource(KnowledgeBaseStatus.class)
    void knowledgeBaseTransitionsMatchContract(KnowledgeBaseStatus from) {
        for (KnowledgeBaseStatus to : KnowledgeBaseStatus.values()) {
            assertThat(from.canTransitionTo(to))
                    .as("%s → %s", from, to)
                    .isEqualTo(KB_TABLE.get(from).contains(to));
        }
    }

    @Test
    void entityRejectsTransitionOutsideTableWith409() {
        Document document = new Document(UUID.randomUUID(), DocumentType.REQUIREMENT, 1, "a.pdf", "k",
                "application/pdf", 1, "0".repeat(64), null);
        assertThatThrownBy(() -> document.completeIndexing(Map.of()))
                .isInstanceOf(InvalidStateTransitionException.class)
                .satisfies(ex -> assertThat(((InvalidStateTransitionException) ex).code())
                        .isEqualTo(ErrorCode.INVALID_STATE_TRANSITION));

        document.startIndexing();
        document.updateIndexProgress(68);
        assertThat(document.getIndexProgress()).isEqualTo(68);
        document.failIndexing("x");
        document.startIndexing();
        assertThat(document.getIndexProgress()).isZero();
        document.completeIndexing(Map.of("requirementCount", 42));
        assertThat(document.getStatus()).isEqualTo(DocumentStatus.INDEXED);
        assertThatThrownBy(() -> document.skipIndexing("x", null)).isInstanceOf(InvalidStateTransitionException.class);
        document.startIndexing();
        document.skipIndexing("다른 문서 오류", Map.of("endpointCount", 4));
        assertThat(document.getSummary()).containsEntry("endpointCount", 4);
        assertThat(document.getStatus()).isEqualTo(DocumentStatus.SKIPPED);
        assertThat(document.getErrorMessage()).isEqualTo("다른 문서 오류");
        document.startIndexing();
        assertThat(document.getErrorMessage()).isNull();

        Document testData = new Document(UUID.randomUUID(), DocumentType.TEST_DATA, 1, "a.json", "k",
                "application/json", 1, "0".repeat(64), null);
        testData.register(Map.of());
        assertThatThrownBy(testData::startIndexing).isInstanceOf(InvalidStateTransitionException.class);
    }

    @Test
    void knowledgeBaseStaleOnlyFromReady() {
        KnowledgeBase kb = new KnowledgeBase(UUID.randomUUID());
        assertThat(kb.markStaleIfReady()).isFalse();
        assertThat(kb.getStatus()).isEqualTo(KnowledgeBaseStatus.NOT_BUILT);
        kb.startBuild();
        assertThatThrownBy(kb::startBuild).isInstanceOf(InvalidStateTransitionException.class);
        kb.completeBuild(10, 1, 2, 3, java.time.Instant.now());
        assertThatThrownBy(kb::startBuild).isInstanceOf(InvalidStateTransitionException.class);
        assertThat(kb.markStaleIfReady()).isTrue();
        assertThat(kb.getStatus()).isEqualTo(KnowledgeBaseStatus.STALE);
        kb.startBuild();
        kb.failBuild("x");
        assertThat(kb.getErrorMessage()).isEqualTo("x");
        kb.startBuild();
        assertThat(kb.getErrorMessage()).isNull();
    }
}
