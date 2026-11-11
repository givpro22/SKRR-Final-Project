package com.skrr.platform.report;

import static com.skrr.platform.common.config.OpenApiConfig.BAD_REQUEST;
import static com.skrr.platform.common.config.OpenApiConfig.CONFLICT;
import static com.skrr.platform.common.config.OpenApiConfig.NOT_FOUND;

import com.skrr.platform.report.ReportDtos.CaseResultDetail;
import com.skrr.platform.report.ReportDtos.RerunRequest;
import com.skrr.platform.report.ReportDtos.RunReport;
import com.skrr.platform.run.RunDtos.RunResponse;
import com.skrr.platform.run.RunService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class ReportController {

    private final ReportService reports;
    private final RunService runs;

    public ReportController(ReportService reports, RunService runs) {
        this.reports = reports;
        this.runs = runs;
    }

    @Tag(name = "report")
    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @ApiResponse(responseCode = "409", ref = CONFLICT)
    @Operation(operationId = "getRunReport", summary = "결과 리포트 (UI-04, FR-06, FR-07)")
    @GetMapping("/runs/{runId}/report")
    public RunReport getRunReport(@PathVariable UUID runId) {
        return reports.report(runId);
    }

    @Tag(name = "report")
    @ApiResponse(responseCode = "200", description = "성공", useReturnTypeSchema = true)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @Operation(operationId = "getCaseResult", summary = "실패 케이스 상세 (UI-04 우측 패널)")
    @GetMapping("/case-results/{caseResultId}")
    public CaseResultDetail getCaseResult(@PathVariable UUID caseResultId) {
        return reports.caseResult(caseResultId);
    }

    @Tag(name = "run")
    @ApiResponse(responseCode = "400", ref = BAD_REQUEST)
    @ApiResponse(responseCode = "404", ref = NOT_FOUND)
    @ApiResponse(responseCode = "409", ref = CONFLICT)
    @Operation(operationId = "rerunRun",
            summary = "실패 건 또는 특정 케이스 재실행 (UI-04 \"실패 2건 재실행\", \"이 케이스 재실행\")")
    @PostMapping("/runs/{runId}/rerun")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public RunResponse rerunRun(@PathVariable UUID runId, @RequestBody(required = false) RerunRequest request) {
        return runs.rerun(runId, request == null ? null : request.caseResultIds());
    }
}
