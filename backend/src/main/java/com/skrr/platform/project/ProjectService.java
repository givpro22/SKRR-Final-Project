package com.skrr.platform.project;

import com.skrr.platform.client.runner.ConnectivityResult;
import com.skrr.platform.client.runner.RunnerClient;
import com.skrr.platform.client.runner.RunnerRequestRejectedException;
import com.skrr.platform.client.runner.RunnerUnavailableException;
import com.skrr.platform.common.error.ApiException;
import com.skrr.platform.common.error.ErrorCode;
import com.skrr.platform.common.time.Times;
import com.skrr.platform.common.user.CurrentUserProvider;
import com.skrr.platform.knowledge.KnowledgeBase;
import com.skrr.platform.knowledge.KnowledgeBaseRepository;
import com.skrr.platform.project.ProjectDtos.ProjectCreate;
import com.skrr.platform.project.ProjectDtos.ProjectUpdate;
import com.skrr.platform.project.ProjectDtos.TargetVerificationResponse;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class ProjectService {

    private static final Logger log = LoggerFactory.getLogger(ProjectService.class);

    private final ProjectRepository projects;
    private final KnowledgeBaseRepository knowledgeBases;
    private final ActivityService activities;
    private final CurrentUserProvider currentUser;
    private final RunnerClient runner;
    private final TransactionTemplate tx;

    public ProjectService(ProjectRepository projects, KnowledgeBaseRepository knowledgeBases,
                          ActivityService activities, CurrentUserProvider currentUser, RunnerClient runner,
                          TransactionTemplate tx) {
        this.projects = projects;
        this.knowledgeBases = knowledgeBases;
        this.activities = activities;
        this.currentUser = currentUser;
        this.runner = runner;
        this.tx = tx;
    }

    @Transactional(readOnly = true)
    public List<Project> list() {
        return projects.findAllByOrderByCreatedAtAsc();
    }

    @Transactional(readOnly = true)
    public Project get(UUID projectId) {
        return projects.findById(projectId).orElseThrow(() -> ApiException.notFound("프로젝트"));
    }

    /** operationId: createProject. 지식 베이스 행(NOT_BUILT)을 함께 만든다. */
    @Transactional
    public Project create(ProjectCreate request) {
        Project project = new Project(request.name().trim(), currentUser.currentUserId());
        project.changeTargetUrl(blankToNull(request.targetUrl()));
        project.changeQueryApiBaseUrl(blankToNull(request.queryApiBaseUrl()));
        project.changeTestControlUrl(blankToNull(request.testControlUrl()));
        projects.saveAndFlush(project);
        knowledgeBases.save(new KnowledgeBase(project.getId()));
        activities.record(project.getId(), "프로젝트 생성: " + project.getName());
        return project;
    }

    /** operationId: updateProject. targetUrl 이 바뀌면 targetUrlStatus 는 UNVERIFIED 로 돌아간다. */
    @Transactional
    public Project update(UUID projectId, ProjectUpdate request) {
        Project project = projects.findByIdForUpdate(projectId).orElseThrow(() -> ApiException.notFound("프로젝트"));
        if (request.name() != null) {
            project.rename(request.name().trim());
        }
        if (request.targetUrl() != null && project.changeTargetUrl(request.targetUrl())) {
            activities.record(projectId, "대상 사이트 URL 변경: " + request.targetUrl());
        }
        if (request.queryApiBaseUrl() != null) {
            project.changeQueryApiBaseUrl(request.queryApiBaseUrl());
        }
        if (request.testControlUrl() != null) {
            project.changeTestControlUrl(request.testControlUrl());
        }
        projects.flush();
        return project;
    }

    /**
     * operationId: verifyTargetSite. 실행기로 대상 사이트 연결을 확인한다 (ADR-019).
     * 대상 접속 실패는 200 + UNREACHABLE, 실행기 장애는 503 DEPENDENCY_UNAVAILABLE,
     * 실행기가 요청을 거부하면 500 INTERNAL_ERROR 이며 뒤의 둘은 프로젝트 상태를 바꾸지 않는다.
     */
    public TargetVerificationResponse verifyTarget(UUID projectId) {
        Project project = get(projectId);
        String targetUrl = project.getTargetUrl();
        if (targetUrl == null || targetUrl.isBlank()) {
            throw new ApiException(ErrorCode.TARGET_URL_MISSING, "대상 사이트 URL을 먼저 입력해 주세요.");
        }

        ConnectivityResult result;
        try {
            result = runner.checkTargetConnectivity(targetUrl);
        } catch (RunnerUnavailableException ex) {
            log.warn("연결 확인 중 실행기 장애: {}", ex.getMessage());
            throw new ApiException(ErrorCode.DEPENDENCY_UNAVAILABLE,
                    "실행기에 연결할 수 없어 연결 확인을 하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        } catch (RunnerRequestRejectedException ex) {
            log.error("실행기가 연결 확인 요청을 거부함: {}", ex.getMessage());
            throw new ApiException(ErrorCode.INTERNAL_ERROR, "연결 확인 요청을 처리하지 못했습니다.");
        }

        Instant checkedAt = Times.now();
        Integer statusCode = result.statusCode();
        String message = result.message() != null && !result.message().isBlank()
                ? result.message()
                : (result.reachable() ? "연결 확인 성공" : "연결 확인 실패") + statusSuffix(statusCode);
        tx.executeWithoutResult(status -> {
            Project locked = projects.findByIdForUpdate(projectId).orElseThrow(() -> ApiException.notFound("프로젝트"));
            // 확인하는 동안 URL이 바뀌었으면 이전 URL의 결과를 저장하지 않는다
            if (Objects.equals(locked.getTargetUrl(), targetUrl)) {
                locked.recordTargetCheck(result.reachable(), statusCode, message, checkedAt);
                activities.record(projectId, (result.reachable() ? "대상 사이트 연결 확인 성공 · " : "대상 사이트 연결 확인 실패 · ")
                        + targetUrl + statusSuffix(statusCode));
            }
        });
        return new TargetVerificationResponse(
                result.reachable() ? TargetUrlStatus.REACHABLE : TargetUrlStatus.UNREACHABLE, checkedAt, statusCode,
                message);
    }

    private static String statusSuffix(Integer statusCode) {
        return statusCode == null ? "" : " (HTTP " + statusCode + ")";
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
