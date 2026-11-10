package com.skrr.platform.knowledge;

import com.skrr.platform.common.error.ApiException;
import com.skrr.platform.common.error.ErrorCode;
import com.skrr.platform.common.job.AsyncJob;
import com.skrr.platform.common.job.AsyncJobRepository;
import com.skrr.platform.common.job.JobType;
import com.skrr.platform.document.Document;
import com.skrr.platform.document.DocumentRepository;
import com.skrr.platform.document.DocumentStatus;
import com.skrr.platform.document.DocumentType;
import com.skrr.platform.knowledge.KnowledgeBaseResponse.ReadinessItem;
import com.skrr.platform.project.ActivityService;
import com.skrr.platform.project.Project;
import com.skrr.platform.project.ProjectRepository;
import com.skrr.platform.project.TargetUrlStatus;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 지식 베이스 상태·등록 요건 조회와 구축 시작 (FR-01, UI-01). */
@Service
public class KnowledgeBaseService {

    public static final String JOB_SUBJECT = "PROJECT";

    private final ProjectRepository projects;
    private final KnowledgeBaseRepository knowledgeBases;
    private final DocumentRepository documents;
    private final AsyncJobRepository jobs;
    private final ActivityService activities;

    public KnowledgeBaseService(ProjectRepository projects, KnowledgeBaseRepository knowledgeBases,
                                DocumentRepository documents, AsyncJobRepository jobs, ActivityService activities) {
        this.projects = projects;
        this.knowledgeBases = knowledgeBases;
        this.documents = documents;
        this.jobs = jobs;
        this.activities = activities;
    }

    /** operationId: getKnowledgeBase */
    @Transactional
    public KnowledgeBaseResponse get(UUID projectId) {
        Project project = projects.findById(projectId).orElseThrow(() -> ApiException.notFound("프로젝트"));
        KnowledgeBase kb = knowledgeBases.findById(projectId)
                .orElseGet(() -> knowledgeBases.save(new KnowledgeBase(projectId)));
        return toResponse(project, kb, activeByType(projectId));
    }

    /**
     * operationId: buildKnowledgeBase. 필수 문서가 빠지면 409 MISSING_REQUIRED_DOCUMENTS 와
     * missingDocumentTypes 를 돌려준다 (FR-01 수용기준). 구축은 async_job 으로 남기고 스케줄러가 AI 서버에 보낸다.
     */
    @Transactional
    public KnowledgeBaseResponse build(UUID projectId) {
        Project project = projects.findByIdForUpdate(projectId).orElseThrow(() -> ApiException.notFound("프로젝트"));
        KnowledgeBase kb = knowledgeBases.findByIdForUpdate(projectId)
                .orElseGet(() -> knowledgeBases.saveAndFlush(new KnowledgeBase(projectId)));
        Map<DocumentType, Document> active = activeByType(projectId);

        List<DocumentType> missing = missingTypes(active);
        if (!missing.isEmpty()) {
            String names = missing.stream().map(DocumentType::label).collect(Collectors.joining(", "));
            throw new ApiException(ErrorCode.MISSING_REQUIRED_DOCUMENTS,
                    "필수 문서 " + missing.size() + "개가 빠져 지식 베이스를 구축할 수 없습니다: " + names,
                    Map.of("missingDocumentTypes", missing));
        }
        kb.startBuild();
        // 재구축도 전체를 다시 인덱싱한다: 활성 필수 문서 3종 모두 INDEXING (ADR-020)
        for (Document document : active.values()) {
            if (document.getType().indexed()) {
                document.startIndexing();
            }
        }
        jobs.save(new AsyncJob(JobType.KB_BUILD, JOB_SUBJECT, projectId));
        activities.record(projectId, "지식 베이스 구축 시작");
        knowledgeBases.flush();
        return toResponse(project, kb, active);
    }

    private Map<DocumentType, Document> activeByType(UUID projectId) {
        return documents.findByProjectIdAndActiveTrue(projectId).stream()
                .collect(Collectors.toMap(Document::getType, Function.identity()));
    }

    private static List<DocumentType> missingTypes(Map<DocumentType, Document> active) {
        return DocumentType.requiredTypes().stream().filter(type -> !active.containsKey(type)).toList();
    }

    static KnowledgeBaseResponse toResponse(Project project, KnowledgeBase kb, Map<DocumentType, Document> active) {
        List<DocumentType> missing = missingTypes(active);
        boolean canBuild = missing.isEmpty() && kb.getStatus().canTransitionTo(KnowledgeBaseStatus.BUILDING);
        return new KnowledgeBaseResponse(project.getId(), kb.getStatus(), kb.getChunkCount(),
                kb.getRequirementCount(), kb.getApiCount(), kb.getUiElementCount(), kb.getLastSyncedAt(),
                kb.getErrorMessage(), readiness(project, kb, active), missing, canBuild);
    }

    /**
     * UI-01 "등록 요건". 문서 내용은 AI 서버가 인덱싱한 뒤에야 알 수 있으므로,
     * 형식 인식과 매핑 항목은 인덱싱 결과(요약 수치)가 있을 때 충족으로 본다.
     */
    private static List<ReadinessItem> readiness(Project project, KnowledgeBase kb,
                                                 Map<DocumentType, Document> active) {
        Optional<Document> requirement = Optional.ofNullable(active.get(DocumentType.REQUIREMENT));
        Optional<Document> apiSpec = Optional.ofNullable(active.get(DocumentType.API_SPEC));
        Optional<Document> catalog = Optional.ofNullable(active.get(DocumentType.CATALOG));
        return List.of(
                new ReadinessItem("TARGET_REACHABLE", "대상 사이트 접속 가능",
                        project.getTargetUrlStatus() == TargetUrlStatus.REACHABLE),
                new ReadinessItem("REQUIREMENT_ID_FORMAT", "요구사항 ID(FR-xx) 형식 인식",
                        requirement.filter(d -> d.getStatus() == DocumentStatus.INDEXED)
                                .map(d -> d.getSummary().getOrDefault("requirementCount", 0) > 0
                                        || kb.getRequirementCount() > 0)
                                .orElse(false)),
                new ReadinessItem("READ_ONLY_QUERY_API", "DB 확인용 읽기 전용 조회 API 명세",
                        apiSpec.isPresent() && project.getQueryApiBaseUrl() != null),
                new ReadinessItem("CATALOG_TESTID_MAPPED", "카탈로그의 data-testid 매핑",
                        catalog.filter(d -> d.getStatus() == DocumentStatus.INDEXED)
                                .map(d -> d.getSummary().getOrDefault("elementCount", 0) > 0
                                        || kb.getUiElementCount() > 0)
                                .orElse(false)));
    }
}
