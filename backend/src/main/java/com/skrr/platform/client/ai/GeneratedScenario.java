package com.skrr.platform.client.ai;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.skrr.platform.scenario.JsonValues.ExpectedValue;
import com.skrr.platform.scenario.JsonValues.GuardFailure;
import com.skrr.platform.scenario.JsonValues.Reference;
import com.skrr.platform.scenario.TestCaseType;
import com.skrr.platform.scenario.VerificationScope;
import java.util.List;

/** ai-api.openapi.yaml 의 GeneratedScenario, GeneratedCase. 재생성 요청의 previous 로도 쓴다. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record GeneratedScenario(String code, String title, String requirementRef, List<VerificationScope> scopes,
                                List<Reference> references, Guard guard, List<GeneratedCase> testCases) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Guard(Boolean passed, Integer attempts, List<GuardFailure> failures) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record GeneratedCase(String code, String title, TestCaseType type, List<VerificationScope> scopes,
                                List<String> preconditions, List<String> steps, String expectedResult,
                                List<ExpectedValue> expectedValues) {
    }
}
