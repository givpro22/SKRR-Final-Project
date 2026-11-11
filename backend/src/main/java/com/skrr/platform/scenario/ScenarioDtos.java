package com.skrr.platform.scenario;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.skrr.platform.request.TestRequestDtos.TestRequestResponse;
import com.skrr.platform.scenario.JsonValues.ExpectedValue;
import com.skrr.platform.scenario.JsonValues.GuardFailure;
import com.skrr.platform.scenario.JsonValues.Reference;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 계약 스키마 Scenario, TestCase, GuardState, ScenarioList, ScenarioUpdate, TestCaseUpdate. */
public final class ScenarioDtos {

    private static final String NOT_BLANK = ".*\\S.*";

    private ScenarioDtos() {
    }

    @Schema(name = "GuardState")
    public record GuardState(int attempt, int maxAttempts, String message, boolean catalogGap,
                             List<GuardFailure> failures) {
        static GuardState from(Scenario s) {
            return new GuardState(s.getGuardAttempt(), Scenario.MAX_GUARD_ATTEMPTS, s.getGuardMessage(),
                    s.catalogGap(), s.getGuardFailures());
        }
    }

    @Schema(name = "TestCase")
    public record TestCaseResponse(
            UUID id,
            String code,
            UUID scenarioId,
            String title,
            TestCaseType type,
            List<VerificationScope> scopes,
            List<String> preconditions,
            List<String> steps,
            String expectedResult,
            List<ExpectedValue> expectedValues,
            int order,
            int version,
            @JsonProperty("isActive") boolean isActive) {

        public static TestCaseResponse from(TestCase c) {
            return new TestCaseResponse(c.getId(), c.getCode(), c.getScenarioId(), c.getTitle(), c.getType(),
                    c.getScopes(), c.getPreconditions(), c.getSteps(), c.getExpectedResult(), c.getExpectedValues(),
                    c.getOrd(), c.getVersion(), c.isActive());
        }
    }

    @Schema(name = "Scenario")
    public record ScenarioResponse(
            UUID id,
            String code,
            UUID testRequestId,
            String title,
            String requirementRef,
            List<VerificationScope> scopes,
            ScenarioStatus status,
            GuardState guard,
            List<Reference> references,
            int version,
            Instant approvedAt,
            int caseCount,
            List<TestCaseResponse> testCases) {

        public static ScenarioResponse from(Scenario s, List<TestCase> activeCases) {
            return new ScenarioResponse(s.getId(), s.getCode(), s.getTestRequestId(), s.getTitle(),
                    s.getRequirementRef(), s.getScopes(), s.getStatus(), GuardState.from(s), s.getReferences(),
                    s.getVersion(), s.getApprovedAt(), activeCases.size(),
                    activeCases.stream().map(TestCaseResponse::from).toList());
        }
    }

    public record Summary(int total, int approved, int reviewRequired, int guardRetry, int generating, int rejected,
                          int guardFailed) {
    }

    @Schema(name = "ScenarioList")
    public record ScenarioListResponse(TestRequestResponse testRequest, Summary summary,
                                       List<ScenarioResponse> items) {
    }

    /**
     * PATCH 본문. requirementRef 는 "필드 없음 = 그대로", "명시적 null = 지움"을 구분해야 해서
     * record 대신 setter 로 받은 적이 있는지 기록한다.
     */
    @Schema(name = "ScenarioUpdate")
    public static final class ScenarioUpdate {

        @Size(min = 1, max = 200)
        @Pattern(regexp = NOT_BLANK, message = "제목은 비울 수 없습니다")
        private String title;

        @Size(max = 50)
        @Schema(types = {"string", "null"}, maxLength = 50)
        private String requirementRef;

        @JsonIgnore
        private boolean requirementRefPresent;

        private List<@NotNull VerificationScope> scopes;

        public ScenarioUpdate() {
        }

        public ScenarioUpdate(String title, String requirementRef, boolean requirementRefPresent,
                              List<VerificationScope> scopes) {
            this.title = title;
            this.requirementRef = requirementRef;
            this.requirementRefPresent = requirementRefPresent;
            this.scopes = scopes;
        }

        public String getTitle() {
            return title;
        }

        public void setTitle(String title) {
            this.title = title;
        }

        public String getRequirementRef() {
            return requirementRef;
        }

        @JsonSetter("requirementRef")
        public void setRequirementRef(String requirementRef) {
            this.requirementRef = requirementRef;
            this.requirementRefPresent = true;
        }

        /** 본문에 requirementRef 가 있었는지 (null 포함). */
        public boolean hasRequirementRef() {
            return requirementRefPresent;
        }

        public List<VerificationScope> getScopes() {
            return scopes;
        }

        public void setScopes(List<VerificationScope> scopes) {
            this.scopes = scopes;
        }
    }

    @Schema(name = "TestCaseUpdate")
    public record TestCaseUpdate(
            @Size(min = 1, max = 200) @Pattern(regexp = NOT_BLANK, message = "제목은 비울 수 없습니다") String title,
            TestCaseType type,
            List<@NotNull VerificationScope> scopes,
            List<@NotNull String> preconditions,
            List<@NotNull String> steps,
            @Size(min = 1) @Pattern(regexp = "(?s).*\\S.*", message = "기대 결과는 비울 수 없습니다") String expectedResult,
            @Size(min = 1) List<@NotNull @Valid ExpectedValue> expectedValues) {
    }

    @Schema(name = "RegenerateRequest")
    public record RegenerateRequest(@Size(max = 500) String feedback) {
    }
}
