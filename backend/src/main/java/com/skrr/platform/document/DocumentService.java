package com.skrr.platform.document;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.skrr.platform.common.config.SkrrProperties;
import com.skrr.platform.common.error.ApiException;
import com.skrr.platform.common.error.ErrorCode;
import com.skrr.platform.common.user.CurrentUserProvider;
import com.skrr.platform.document.storage.FileStorage;
import com.skrr.platform.document.storage.StorageKeys;
import com.skrr.platform.knowledge.KnowledgeBase;
import com.skrr.platform.knowledge.KnowledgeBaseRepository;
import com.skrr.platform.knowledge.KnowledgeBaseStatus;
import com.skrr.platform.project.ActivityService;
import com.skrr.platform.project.ProjectRepository;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;

/** 기준 문서 등록·조회·삭제 (FR-01, WBS 4.3.2). */
@Service
public class DocumentService {

    /** 20MB. schema.sql document.size_bytes CHECK 와 같다. */
    public static final long MAX_FILE_BYTES = 20L * 1024 * 1024;

    private static final Logger log = LoggerFactory.getLogger(DocumentService.class);

    private final DocumentRepository documents;
    private final ProjectRepository projects;
    private final KnowledgeBaseRepository knowledgeBases;
    private final ActivityService activities;
    private final FileStorage storage;
    private final CurrentUserProvider currentUser;
    private final ObjectMapper objectMapper;
    private final SkrrProperties properties;

    public DocumentService(DocumentRepository documents, ProjectRepository projects,
                           KnowledgeBaseRepository knowledgeBases, ActivityService activities, FileStorage storage,
                           CurrentUserProvider currentUser, ObjectMapper objectMapper, SkrrProperties properties) {
        this.documents = documents;
        this.projects = projects;
        this.knowledgeBases = knowledgeBases;
        this.activities = activities;
        this.storage = storage;
        this.currentUser = currentUser;
        this.objectMapper = objectMapper;
        this.properties = properties;
    }

    @Transactional(readOnly = true)
    public List<Document> listActive(UUID projectId) {
        if (!projects.existsById(projectId)) {
            throw ApiException.notFound("프로젝트");
        }
        return documents.findByProjectIdAndActiveTrue(projectId).stream()
                .sorted(Comparator.comparing(Document::getType))
                .toList();
    }

    @Transactional(readOnly = true)
    public Document get(UUID documentId) {
        return documents.findById(documentId).orElseThrow(() -> ApiException.notFound("문서"));
    }

    /**
     * operationId: uploadDocument. 같은 유형의 기존 활성 문서는 비활성화하고 version 을 1 올린다.
     * 필수 문서(지식 베이스에 들어가는 문서)가 바뀌면 지식 베이스가 READY 일 때 STALE 로 바꾼다.
     * TEST_DATA 는 AI로 보내지 않으므로 STALE 을 만들지 않는다 (ADR-020).
     */
    @Transactional
    public Document upload(UUID projectId, DocumentType type, MultipartFile file) {
        projects.findByIdForUpdate(projectId).orElseThrow(() -> ApiException.notFound("프로젝트"));
        validateSize(file);
        String filename = StorageKeys.sanitizeFilename(file.getOriginalFilename());
        String extension = StorageKeys.extensionOf(filename)
                .filter(type::accepts)
                .orElseThrow(() -> new ApiException(ErrorCode.UNSUPPORTED_FILE_TYPE,
                        type.label() + "는 " + String.join(", ", type.extensions()) + " 파일만 올릴 수 있습니다.",
                        Map.of("allowedExtensions", type.extensions())));
        byte[] content = readBytes(file);
        Map<String, Integer> testDataSummary =
                type == DocumentType.TEST_DATA ? TestDataSummary.summarize(objectMapper, content) : null;

        documents.findByProjectIdAndTypeAndActiveTrue(projectId, type).ifPresent(previous -> {
            previous.deactivate();
            // 활성 문서 부분 유니크 인덱스 때문에 새 행을 넣기 전에 비활성화를 먼저 반영한다
            documents.saveAndFlush(previous);
        });
        int version = documents.findMaxVersion(projectId, type) + 1;
        String key = StorageKeys.documentKey(type.storagePrefix(), projectId, filename);
        Document document = new Document(projectId, type, version, filename, key,
                DocumentType.contentTypeOf(extension), content.length, sha256(content), currentUser.currentUserId());
        if (testDataSummary != null) {
            document.register(testDataSummary);
        }

        storage.put(key, content, document.getContentType());
        deleteOnRollback(key);
        documents.saveAndFlush(document);

        if (type.indexed()) {
            markKnowledgeBaseStale(projectId);
        }
        activities.record(projectId, filename + " 업로드 · " + type.label() + " v" + version + " 저장");
        return document;
    }

    /**
     * operationId: deleteDocument. 지식 베이스 구축 중이면 409. 활성 필수 문서를 지우면 READY → STALE
     * (TEST_DATA 는 STALE 을 만들지 않음).
     */
    @Transactional
    public void delete(UUID documentId) {
        Document document = documents.findById(documentId).orElseThrow(() -> ApiException.notFound("문서"));
        UUID projectId = document.getProjectId();
        projects.findByIdForUpdate(projectId).orElseThrow(() -> ApiException.notFound("프로젝트"));
        KnowledgeBase kb = knowledgeBases.findByIdForUpdate(projectId).orElse(null);
        if (document.isActive() && document.getStatus() == DocumentStatus.INDEXING
                || kb != null && kb.getStatus() == KnowledgeBaseStatus.BUILDING) {
            throw new ApiException(ErrorCode.INVALID_STATE_TRANSITION,
                    "지식 베이스 구축 중에는 문서를 삭제할 수 없습니다. 구축이 끝난 뒤 다시 시도해 주세요.");
        }
        boolean wasActive = document.isActive();
        documents.delete(document);
        documents.flush();
        if (wasActive && document.getType().indexed() && kb != null) {
            kb.markStaleIfReady();
        }
        activities.record(projectId, document.getOriginalFilename() + " 삭제");
        String key = document.getStorageKey();
        afterCommit(() -> {
            try {
                storage.delete(key);
            } catch (RuntimeException ex) {
                log.warn("저장소 파일 삭제 실패 (DB 행은 삭제됨): {}", key, ex);
            }
        });
    }

    /** operationId: getDocumentDownloadLink. */
    @Transactional(readOnly = true)
    public FileStorage.PresignedLink downloadLink(UUID documentId) {
        Document document = get(documentId);
        return storage.presignDownload(document.getStorageKey(), document.getOriginalFilename(),
                properties.storage().presignTtl());
    }

    private void markKnowledgeBaseStale(UUID projectId) {
        knowledgeBases.findByIdForUpdate(projectId).ifPresent(KnowledgeBase::markStaleIfReady);
    }

    private static void validateSize(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "빈 파일은 올릴 수 없습니다.");
        }
        if (file.getSize() > MAX_FILE_BYTES) {
            throw new ApiException(ErrorCode.FILE_TOO_LARGE, "파일은 20MB 이하만 올릴 수 있습니다.");
        }
    }

    private static byte[] readBytes(MultipartFile file) {
        try {
            return file.getBytes();
        } catch (IOException ex) {
            throw new UncheckedIOException("업로드 파일을 읽지 못했습니다", ex);
        }
    }

    private static String sha256(byte[] content) {
        try {
            return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }

    private void deleteOnRollback(String key) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCompletion(int status) {
                if (status != STATUS_COMMITTED) {
                    try {
                        storage.delete(key);
                    } catch (RuntimeException ex) {
                        log.warn("롤백된 업로드의 파일 삭제 실패: {}", key, ex);
                    }
                }
            }
        });
    }

    private static void afterCommit(Runnable action) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                action.run();
            }
        });
    }
}
