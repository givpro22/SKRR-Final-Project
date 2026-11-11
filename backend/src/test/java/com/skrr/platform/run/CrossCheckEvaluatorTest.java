package com.skrr.platform.run;

import static org.assertj.core.api.Assertions.assertThat;

import com.skrr.platform.run.CrossCheckEvaluator.Input;
import com.skrr.platform.run.CrossCheckEvaluator.Normalize;
import com.skrr.platform.run.RunEnums.Verdict;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** state-machines.md "crossChecks 판정" 표의 모든 행. */
class CrossCheckEvaluatorTest {

    private static Verdict eval(String ui, String api, String db, String expected, boolean consistency, Normalize n) {
        return CrossCheckEvaluator.evaluate(new Input(true, ui, true, api, true, db, expected, consistency, n));
    }

    @Test
    void missingValueIsMismatch() {
        assertThat(eval("3", null, "3", "3", false, Normalize.NONE)).isEqualTo(Verdict.MISMATCH);
        assertThat(eval("3", "3", null, null, true, Normalize.NONE)).isEqualTo(Verdict.MISMATCH);
    }

    @Test
    void differentValuesAreMismatch() {
        assertThat(eval("3", "3", "2", "3", false, Normalize.NONE)).isEqualTo(Verdict.MISMATCH);
        assertThat(eval("A-1", "A-2", "A-1", null, true, Normalize.NONE)).isEqualTo(Verdict.MISMATCH);
    }

    @Test
    void sameValuesButDifferentFromExpectedIsMismatch() {
        // 세 값이 함께 틀려도 기대값과 다르면 불일치 (ADR-014)
        assertThat(eval("2", "2", "2", "3", false, Normalize.NONE)).isEqualTo(Verdict.MISMATCH);
    }

    @Test
    void sameValuesMatchingExpectedIsMatch() {
        assertThat(eval("3", "3", "3", "3", false, Normalize.NONE)).isEqualTo(Verdict.MATCH);
    }

    @Test
    void consistencyOnlyWithEqualValuesIsMatch() {
        assertThat(eval("ORD-77", "ORD-77", "ORD-77", null, true, Normalize.NONE)).isEqualTo(Verdict.MATCH);
    }

    @Test
    void noSourceIsNotApplicable() {
        assertThat(CrossCheckEvaluator.evaluate(new Input(false, null, false, null, false, null, "3", false,
                Normalize.NONE))).isEqualTo(Verdict.NOT_APPLICABLE);
    }

    @Test
    void currencyAndNumberNormalization() {
        assertThat(eval("₩87,400", "87400", "87400.00", "87,400원", false, Normalize.CURRENCY)).isEqualTo(Verdict.MATCH);
        assertThat(eval("₩87,400", "87400", "87400", "87400", false, Normalize.NONE)).isEqualTo(Verdict.MISMATCH);
        assertThat(eval("3", "3.0", " 3 ", "3", false, Normalize.NUMBER)).isEqualTo(Verdict.MATCH);
        assertThat(eval("abc", "abc", "abc", "abc", false, Normalize.NUMBER)).isEqualTo(Verdict.MISMATCH);
        // 일부 출처만 지정
        assertThat(CrossCheckEvaluator.evaluate(new Input(true, "5", false, null, true, "5", "5", false,
                Normalize.NONE))).isEqualTo(Verdict.MATCH);
    }

    @Test
    void skippedSourceIsExcludedAndSingleSourceConsistencyIsNotApplicable() {
        // DB 를 설정 때문에 건너뜀 → usedDb=false, 남은 화면·API 로 판정
        assertThat(CrossCheckEvaluator.evaluate(new Input(true, "3", true, "3", false, null, "3", false,
                Normalize.NONE))).isEqualTo(Verdict.MATCH);
        assertThat(CrossCheckEvaluator.evaluate(new Input(true, "3", true, "2", false, null, "3", false,
                Normalize.NONE))).isEqualTo(Verdict.MISMATCH);
        // 기대값이 있으면 출처 1개로도 판정한다
        assertThat(CrossCheckEvaluator.evaluate(new Input(true, "3", false, null, false, null, "3", false,
                Normalize.NONE))).isEqualTo(Verdict.MATCH);
        // consistencyOnly 인데 남은 출처가 1개 → 비교 상대가 없음
        assertThat(CrossCheckEvaluator.evaluate(new Input(true, "ORD-1", false, null, false, null, null, true,
                Normalize.NONE))).isEqualTo(Verdict.NOT_APPLICABLE);
        // 실행 중 값을 얻지 못함(지정했는데 null) → MISMATCH 유지
        assertThat(CrossCheckEvaluator.evaluate(new Input(true, "3", true, "3", true, null, "3", false,
                Normalize.NONE))).isEqualTo(Verdict.MISMATCH);
    }

    @Test
    void templateFillMasksSecrets() {
        Map<String, String> vars = Map.of("qty", "3");
        Map<String, String> secrets = Map.of("pw", "s3cret");
        assertThat(TemplateValues.fill("{{qty}}/{{pw}}/{{cap}}/{{none}}", vars, secrets, Map.of("cap", "x"), true))
                .isEqualTo("3/***/x/{{none}}");
        assertThat(TemplateValues.fill("{{pw}}", vars, secrets, Map.of(), false)).isEqualTo("s3cret");
        assertThat(TemplateValues.references("a {{x}} {{ y }} {{x}}")).containsExactly("x", "y");
    }
}
