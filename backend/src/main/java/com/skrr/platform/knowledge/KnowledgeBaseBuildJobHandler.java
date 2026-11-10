package com.skrr.platform.knowledge;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skrr.platform.client.ai.AiClient;
import com.skrr.platform.client.ai.AiJob;
import com.skrr.platform.client.ai.KnowledgeBaseBuildRequest;
import com.skrr.platform.client.ai.KnowledgeBaseBuildResult;
import com.skrr.platform.common.job.AsyncJob;
import com.skrr.platform.common.job.AsyncJobHandler;
import com.skrr.platform.common.job.InvalidJobResultException;
import com.skrr.platform.common.job.JobType;
import com.skrr.platform.common.time.Times;
import com.skrr.platform.document.Document;
import com.skrr.platform.document.DocumentRepository;
import com.skrr.platform.document.DocumentStatus;
import com.skrr.platform.project.ActivityService;
import com.skrr.platform.project.ProjectRepository;
import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * KB_BUILD 작업. AI 서버(startKnowledgeBaseBuild)에 활성 필수 문서를 보내고 결과를 지식 베이스와 문서 상태에 반영한다.
 * TEST_DATA 는 비밀값이 있어 보내지 않는다. 상태 규칙은 state-machines.md Document·KnowledgeBase (ADR-018, ADR-020).
 * 비활성(이전 버전) 문서의 상태는 바꾸지 않는다.
 */
@Component
public class KnowledgeBaseBuildJobHandler implements AsyncJobHandler {

    private static final Logger log = LoggerFactory.getLogger(KnowledgeBaseBuildJobHandler.class);

    private final AiClient ai;
    private final ProjectRepository projects;
    private final KnowledgeBaseRepository knowledgeBases;
    private final DocumentRepository documents;
    private final ActivityService activities;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate tx;

    public KnowledgeBaseBuildJobHandler(AiClient ai, ProjectRepository projects,
                                        KnowledgeBaseRepository knowledgeBases, DocumentRepository documents,
                                        ActivityService activities, ObjectMapper objectMapper,
                                        TransactionTemplate tx) {
        this.ai = ai;
        this.projects = projects;
        this.knowledgeBases = knowledgeBases;
        this.documents = documents;
        this.activities = activities;
        this.objectMapper = objectMapper;
        this.tx = tx;
    }

    @Override
    public JobType type() {
        return JobType.KB_BUILD;
    }

    @Override
    public AiJob submit(AsyncJob job) {
        UUID projectId = job.getSubjectId();
        KnowledgeBaseBuildRequest request = tx.execute(status -> prepareRequest(projectId));
        return ai.startKnowledgeBaseBuild(projectId, request);
    }

    /**
     * 보내는 시점의 활성 필수 문서로 요청을 만든다. 구축 요청 뒤 전송 전에 새 버전이 올라왔으면
     * 그 문서도 이번 구축에 넣어 INDEXING 으로 바꾼다.
     */
    private KnowledgeBaseBuildRequest prepareRequest(UUID projectId) {
        projects.findByIdForUpdate(projectId);
        boolean building = knowledgeBases.findByIdForUpdate(projectId)
                .map(kb -> kb.getStatus() == KnowledgeBaseStatus.BUILDING)
                .orElse(false);
        List<Document> indexed = activeIndexedDocuments(projectId);
        if (building) {
            indexed.stream()
                    .filter(d -> d.getStatus() != DocumentStatus.INDEXING)
                    .forEach(Document::startIndexing);
        }
        return new KnowledgeBaseBuildRequest(indexed.stream()
                .map(d -> new KnowledgeBaseBuildRequest.Document(d.getId(), d.getType().name(),
                        d.getVersion(), d.getStorageKey(), d.getContentType(), d.getChecksumSha256()))
                .toList());
    }

    @Override
    public void onProgress(AsyncJob job, AiJob remote) {
        if (remote.progress() == null || remote.progress().percent() == null) {
            return;
        }
        int percent = remote.progress().percent();
        indexingDocuments(job.getSubjectId()).forEach(document -> document.updateIndexProgress(percent));
    }

    @Override
    public void onSucceeded(AsyncJob job, AiJob remote) {
        KnowledgeBaseBuildResult result = parse(remote);
        UUID projectId = job.getSubjectId();
        projects.findByIdForUpdate(projectId);
        Optional<KnowledgeBase> maybeKb = knowledgeBases.findByIdForUpdate(projectId);
        if (maybeKb.isEmpty() || maybeKb.get().getStatus() != KnowledgeBaseStatus.BUILDING) {
            log.warn("구축 중이 아닌 지식 베이스의 결과를 무시합니다: projectId={}", projectId);
            return;
        }
        KnowledgeBase kb = maybeKb.get();

        Map<UUID, KnowledgeBaseBuildResult.DocumentResult> byId = byDocumentId(result);
        List<String> failures = applyDocumentResults(projectId, byId, "AI 서버 결과에 이 문서가 없습니다");
        if (!failures.isEmpty()) {
            String message = "문서 인덱싱 실패 - " + String.join("; ", failures);
            kb.failBuild(message);
            activities.record(projectId, "지식 베이스 구축 실패: " + message);
            return;
        }
        kb.completeBuild(result.chunkCount(), result.requirementCount(), result.apiCount(),
                result.uiElementCount(), Times.now());
        activities.record(projectId, "지식 베이스 구축 완료 · 청크 "
                + NumberFormat.getIntegerInstance(Locale.KOREA).format(result.chunkCount()) + "개");

        // 결과에 없는 활성 필수 문서가 있으면(전송 뒤 새 버전 업로드) 결과가 이미 낡았다 (READY → STALE).
        // TEST_DATA 는 지식 베이스에 들어가지 않으므로 보지 않는다 (ADR-020)
        boolean changedDuringBuild = activeIndexedDocuments(projectId).stream()
                .anyMatch(d -> !byId.containsKey(d.getId()));
        if (changedDuringBuild && kb.markStaleIfReady()) {
            activities.record(projectId, "구축 중 문서가 바뀌어 지식 베이스를 다시 구축해야 합니다");
        }
    }

    @Override
    public void onFailed(AsyncJob job, String message) {
        onFailed(job, message, null);
    }

    /**
     * 작업 실패. AI 결과에 문서별 상태가 있으면 원인 문서는 FAILED, 나머지는 SKIPPED 로 그대로 반영한다.
     * 특정 문서가 원인이 아닌 실패(AI 장애, 인덱스 저장 실패, 전송 실패)는 처리 중 문서를 모두 FAILED + 같은 사유.
     */
    @Override
    public void onFailed(AsyncJob job, String message, AiJob remote) {
        UUID projectId = job.getSubjectId();
        Map<UUID, KnowledgeBaseBuildResult.DocumentResult> byId = documentResultsOf(remote);
        projects.findByIdForUpdate(projectId);
        knowledgeBases.findByIdForUpdate(projectId)
                .filter(kb -> kb.getStatus() == KnowledgeBaseStatus.BUILDING)
                .ifPresent(kb -> kb.failBuild(message));
        applyDocumentResults(projectId, byId, message);
        activities.record(projectId, "지식 베이스 구축 실패: " + message);
    }

    /**
     * 처리 중(INDEXING)인 활성 문서에 결과를 반영하고 실패 사유 목록을 돌려준다.
     * 결과에 없는 문서는 FAILED + missingReason.
     */
    private List<String> applyDocumentResults(UUID projectId, Map<UUID, KnowledgeBaseBuildResult.DocumentResult> byId,
                                              String missingReason) {
        List<String> failures = new ArrayList<>();
        for (Document document : indexingDocuments(projectId)) {
            KnowledgeBaseBuildResult.DocumentResult documentResult = byId.get(document.getId());
            String status = documentResult == null ? null : documentResult.status();
            String error = documentResult == null || documentResult.error() == null ? null : documentResult.error();
            if ("INDEXED".equals(status)) {
                document.completeIndexing(documentResult.summary());
            } else if ("SKIPPED".equals(status)) {
                document.skipIndexing(error == null ? "다른 문서의 오류로 처리하지 않았습니다" : error,
                        documentResult.summary());
            } else {
                String reason = documentResult == null ? missingReason : error == null ? "인덱싱 실패" : error;
                document.failIndexing(reason);
                failures.add(document.getOriginalFilename() + ": " + reason);
            }
        }
        return failures;
    }

    private List<Document> activeIndexedDocuments(UUID projectId) {
        return documents.findByProjectIdAndActiveTrue(projectId).stream()
                .filter(d -> d.getType().indexed())
                .sorted((a, b) -> a.getType().compareTo(b.getType()))
                .toList();
    }

    private List<Document> indexingDocuments(UUID projectId) {
        return activeIndexedDocuments(projectId).stream()
                .filter(d -> d.getStatus() == DocumentStatus.INDEXING)
                .toList();
    }

    private static Map<UUID, KnowledgeBaseBuildResult.DocumentResult> byDocumentId(KnowledgeBaseBuildResult result) {
        Map<UUID, KnowledgeBaseBuildResult.DocumentResult> byId = new HashMap<>();
        if (result.documents() != null) {
            result.documents().stream().filter(d -> d.documentId() != null).forEach(d -> byId.put(d.documentId(), d));
        }
        return byId;
    }

    /** 실패한 작업의 result(있으면)에서 문서별 결과를 꺼낸다. 해석하지 못하면 비어 있다. */
    private Map<UUID, KnowledgeBaseBuildResult.DocumentResult> documentResultsOf(AiJob remote) {
        if (remote == null || remote.result() == null || remote.result().isNull()) {
            return Map.of();
        }
        try {
            return byDocumentId(objectMapper.treeToValue(remote.result(), KnowledgeBaseBuildResult.class));
        } catch (JsonProcessingException | IllegalArgumentException ex) {
            log.warn("실패한 AI 작업의 결과를 해석하지 못했습니다: {}", ex.getMessage());
            return Map.of();
        }
    }

    /** 결과를 먼저 검사한다. 상태를 바꾸기 전에 실패해야 일부만 반영되는 일이 없다. */
    private KnowledgeBaseBuildResult parse(AiJob remote) {
        if (remote.result() == null || remote.result().isNull()) {
            throw new InvalidJobResultException("AI 작업이 성공했지만 결과가 없습니다");
        }
        KnowledgeBaseBuildResult result;
        try {
            result = objectMapper.treeToValue(remote.result(), KnowledgeBaseBuildResult.class);
        } catch (JsonProcessingException | IllegalArgumentException ex) {
            throw new InvalidJobResultException("AI 구축 결과 형식이 계약과 다릅니다: " + ex.getMessage());
        }
        if (!"KB_BUILD".equals(result.kind()) || result.documents() == null) {
            throw new InvalidJobResultException("AI 구축 결과 형식이 계약과 다릅니다 (kind=" + result.kind() + ")");
        }
        return result;
    }
}
