package com.skrr.platform.scenario;

import com.skrr.platform.client.ai.GeneratedScenario;
import com.skrr.platform.client.ai.GeneratedScenario.GeneratedCase;
import com.skrr.platform.client.ai.ScenarioGenerationResult;
import com.skrr.platform.common.job.InvalidJobResultException;
import com.skrr.platform.scenario.JsonValues.ExpectedValue;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * AI 생성 결과를 저장 전에 검사한다 (SC-·TC- 코드, 길이, 가드, 기대값 규칙 ADR-017).
 * 하나라도 어기면 작업을 실패로 끝내고 아무것도 저장하지 않는다.
 */
final class GenerationResultValidator {

    static final Pattern SCENARIO_CODE = Pattern.compile("^SC-\\d{1,4}$");
    static final Pattern CASE_CODE = Pattern.compile("^TC-\\d{1,5}$");

    private GenerationResultValidator() {
    }

    static List<GeneratedScenario> validate(ScenarioGenerationResult result, Set<String> usedCaseCodes) {
        if (result == null || !"SCENARIO_GENERATE".equals(result.kind())) {
            throw invalid("kind가 SCENARIO_GENERATE가 아닙니다");
        }
        if (result.scenarios() == null || result.scenarios().isEmpty()) {
            throw invalid("시나리오가 없습니다");
        }
        Set<String> scenarioCodes = new HashSet<>();
        Set<String> caseCodes = new HashSet<>(usedCaseCodes);
        for (GeneratedScenario s : result.scenarios()) {
            String where = "시나리오 " + s.code();
            require(s.code() != null && SCENARIO_CODE.matcher(s.code()).matches(), where + ": 코드 형식(SC-01)이 아닙니다");
            require(scenarioCodes.add(s.code()), where + ": 코드가 중복됩니다");
            requireText(s.title(), 200, where + ": 제목");
            require(s.requirementRef() == null || s.requirementRef().length() <= 50, where + ": requirementRef가 50자를 넘습니다");
            require(s.scopes() != null && !s.scopes().contains(null), where + ": scopes가 없습니다");
            require(s.guard() != null && s.guard().passed() != null && s.guard().attempts() != null
                    && s.guard().attempts() >= 1 && s.guard().attempts() <= 3, where + ": guard 형식이 다릅니다");
            require(s.guard().failures() == null || s.guard().failures().stream()
                    .allMatch(f -> f != null && f.kind() != null && f.message() != null), where + ": guard.failures 형식이 다릅니다");
            require(s.testCases() != null, where + ": testCases가 없습니다");
            for (GeneratedCase c : s.testCases()) {
                String caseWhere = where + " 케이스 " + c.code();
                require(c.code() != null && CASE_CODE.matcher(c.code()).matches(), caseWhere + ": 코드 형식(TC-12)이 아닙니다");
                require(caseCodes.add(c.code()), caseWhere + ": 요청 안에서 이미 쓴 TC 번호입니다");
                requireText(c.title(), 200, caseWhere + ": 제목");
                require(c.type() != null, caseWhere + ": type이 없습니다");
                require(c.scopes() != null && !c.scopes().contains(null), caseWhere + ": scopes가 없습니다");
                require(c.steps() != null && !c.steps().contains(null), caseWhere + ": steps가 없습니다");
                require(c.preconditions() == null || !c.preconditions().contains(null), caseWhere + ": preconditions 형식");
                require(c.expectedResult() != null && !c.expectedResult().isBlank(), caseWhere + ": expectedResult가 없습니다");
                require(c.expectedValues() != null && !c.expectedValues().isEmpty(),
                        caseWhere + ": expectedValues가 1개 이상 필요합니다 (ADR-017)");
                for (ExpectedValue v : c.expectedValues()) {
                    String violation = v == null ? "빈 항목" : v.violation();
                    require(violation == null, caseWhere + ": expectedValues " + violation);
                }
            }
        }
        return result.scenarios();
    }

    private static void requireText(String text, int max, String what) {
        require(text != null && !text.isBlank(), what + "이 비어 있습니다");
        require(text.length() <= max, what + "이 " + max + "자를 넘습니다");
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw invalid(message);
        }
    }

    private static InvalidJobResultException invalid(String message) {
        return new InvalidJobResultException("AI 시나리오 생성 결과가 계약과 다릅니다: " + message);
    }
}
