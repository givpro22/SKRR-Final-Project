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
