package com.skrr.platform.project;

import static com.skrr.platform.common.config.OpenApiConfig.BAD_REQUEST;
import static com.skrr.platform.common.config.OpenApiConfig.CONFLICT;
import static com.skrr.platform.common.config.OpenApiConfig.NOT_FOUND;
import static com.skrr.platform.common.config.OpenApiConfig.SERVICE_UNAVAILABLE;

import com.skrr.platform.common.web.ItemsResponse;
import com.skrr.platform.project.ProjectDtos.ActivityResponse;
import com.skrr.platform.project.ProjectDtos.ProjectCreate;
import com.skrr.platform.project.ProjectDtos.ProjectResponse;
import com.skrr.platform.project.ProjectDtos.ProjectUpdate;
import com.skrr.platform.project.ProjectDtos.TargetVerificationResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
@Tag(name = "project")
public class ProjectController {

    private final ProjectService projects;
    private final ActivityService activities;

    public ProjectController(ProjectService projects, ActivityService activities) {
        this.projects = projects;
        this.activities = activities;
    }

    @Operation(operationId = "listProjects", summary = "프로젝트 목록 (사이드바 프로젝트 선택)")
    @GetMapping("/projects")
    public ItemsResponse<ProjectResponse> listProjects() {
        return new ItemsResponse<>(projects.list().stream().map(ProjectResponse::from).toList());
    }

    @ApiResponse(responseCode = "400", ref = BAD_REQUEST)
    @Operation(operationId = "createProject", summary = "프로젝트 생성")
    @PostMapping("/projects")
    @ResponseStatus(HttpStatus.CREATED)
    public ProjectResponse createProject(@Valid @RequestBody ProjectCreate request) {
        return ProjectResponse.from(projects.create(request));
    }

    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "getProject", summary = "프로젝트 조회")
    @GetMapping("/projects/{projectId}")
    public ProjectResponse getProject(@PathVariable UUID projectId) {
        return ProjectResponse.from(projects.get(projectId));
    }

    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "400", ref = BAD_REQUEST)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "updateProject", summary = "프로젝트와 대상 사이트 URL 수정 (UI-01)")
    @PatchMapping("/projects/{projectId}")
    public ProjectResponse updateProject(@PathVariable UUID projectId, @Valid @RequestBody ProjectUpdate request) {
        return ProjectResponse.from(projects.update(projectId, request));
    }

    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @ApiResponse(responseCode = "409", ref = CONFLICT)
    @ApiResponse(responseCode = "503", ref = SERVICE_UNAVAILABLE)
    @Operation(operationId = "verifyTargetSite",
            summary = "대상 사이트 연결 확인 (UI-01 \"연결 확인\" 배지)")
    @PostMapping("/projects/{projectId}/target-verification")
    public TargetVerificationResponse verifyTargetSite(@PathVariable UUID projectId) {
        return projects.verifyTarget(projectId);
    }

    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "listActivities", summary = "최근 활동 (UI-01 우측)")
    @GetMapping("/projects/{projectId}/activities")
    public ItemsResponse<ActivityResponse> listActivities(
            @PathVariable UUID projectId,
            @RequestParam(defaultValue = "10") @Min(1) @Max(50) int limit) {
        projects.get(projectId);
        return new ItemsResponse<>(activities.recent(projectId, limit).stream().map(ActivityResponse::from).toList());
    }
}
