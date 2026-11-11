package com.skrr.platform.scenario;

import static com.skrr.platform.common.config.OpenApiConfig.BAD_REQUEST;
import static com.skrr.platform.common.config.OpenApiConfig.CONFLICT;
import static com.skrr.platform.common.config.OpenApiConfig.NOT_FOUND;

import com.skrr.platform.scenario.ScenarioDtos.RegenerateRequest;
import com.skrr.platform.scenario.ScenarioDtos.ScenarioListResponse;
import com.skrr.platform.scenario.ScenarioDtos.ScenarioResponse;
import com.skrr.platform.scenario.ScenarioDtos.ScenarioUpdate;
import com.skrr.platform.scenario.ScenarioDtos.TestCaseResponse;
import com.skrr.platform.scenario.ScenarioDtos.TestCaseUpdate;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
@Tag(name = "scenario")
public class ScenarioController {

    private final ScenarioService scenarios;

    public ScenarioController(ScenarioService scenarios) {
        this.scenarios = scenarios;
    }

    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "listScenarios", summary = "시나리오·케이스 조회 (UI-02-5)")
    @GetMapping("/test-requests/{testRequestId}/scenarios")
    public ScenarioListResponse listScenarios(@PathVariable UUID testRequestId) {
        return scenarios.list(testRequestId);
    }

    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "getScenario", summary = "시나리오 조회")
    @GetMapping("/scenarios/{scenarioId}")
    public ScenarioResponse getScenario(@PathVariable UUID scenarioId) {
        return scenarios.get(scenarioId);
    }

    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "400", ref = BAD_REQUEST)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @ApiResponse(responseCode = "409", ref = CONFLICT)
    @Operation(operationId = "updateScenario", summary = "시나리오 수정 (UI-02-5 연필 아이콘)")
    @PatchMapping("/scenarios/{scenarioId}")
    public ScenarioResponse updateScenario(@PathVariable UUID scenarioId, @Valid @RequestBody ScenarioUpdate patch) {
        return scenarios.update(scenarioId, patch);
    }

    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @ApiResponse(responseCode = "409", ref = CONFLICT)
    @Operation(operationId = "approveScenario", summary = "시나리오 승인 (FR-03)")
    @PostMapping("/scenarios/{scenarioId}/approve")
    public ScenarioResponse approveScenario(@PathVariable UUID scenarioId) {
        return scenarios.approve(scenarioId);
    }

    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @ApiResponse(responseCode = "409", ref = CONFLICT)
    @Operation(operationId = "rejectScenario", summary = "시나리오 반려")
    @PostMapping("/scenarios/{scenarioId}/reject")
    public ScenarioResponse rejectScenario(@PathVariable UUID scenarioId) {
        return scenarios.reject(scenarioId);
    }

    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @ApiResponse(responseCode = "409", ref = CONFLICT)
    @Operation(operationId = "regenerateScenario", summary = "시나리오 재생성")
    @PostMapping("/scenarios/{scenarioId}/regenerate")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ScenarioResponse regenerateScenario(@PathVariable UUID scenarioId,
                                               @Valid @RequestBody(required = false) RegenerateRequest request) {
        return scenarios.regenerate(scenarioId, request == null ? null : request.feedback());
    }

    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "getTestCase", summary = "테스트 케이스 상세 (UI-02-5 행 펼치기)")
    @GetMapping("/test-cases/{testCaseId}")
    public TestCaseResponse getTestCase(@PathVariable UUID testCaseId) {
        return scenarios.getTestCase(testCaseId);
    }

    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "400", ref = BAD_REQUEST)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @ApiResponse(responseCode = "409", ref = CONFLICT)
    @Operation(operationId = "updateTestCase", summary = "테스트 케이스 수정")
    @PatchMapping("/test-cases/{testCaseId}")
    public TestCaseResponse updateTestCase(@PathVariable UUID testCaseId, @Valid @RequestBody TestCaseUpdate patch) {
        return scenarios.updateTestCase(testCaseId, patch);
    }
}
