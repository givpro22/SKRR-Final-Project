package com.skrr.platform.run;

import com.skrr.platform.run.RunEnums.Verdict;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * 교차 검증 판정 (state-machines.md "crossChecks 판정"). 판정은 수집한 값으로만 계산한다.
 * <ul>
 *   <li>지정한 출처의 값을 얻지 못함 → MISMATCH (null 은 일치로 보지 않는다)</li>
 *   <li>값들이 서로 다름 → MISMATCH</li>
 *   <li>값들이 같지만 expected 와 다름 → MISMATCH</li>
 *   <li>값들이 같고 expected 와 같음, 또는 consistencyOnly 이고 값들이 같음 → MATCH</li>
 *   <li>비교할 출처가 없음 → NOT_APPLICABLE</li>
 *   <li>consistencyOnly 인데 비교할 출처가 1개뿐 → NOT_APPLICABLE (같은지 비교할 상대가 없음)</li>
 * </ul>
 * 설정이 없어 건너뛴 출처(queryApiBaseUrl 이 없어 DB 단계 SKIPPED)는 호출하는 쪽이 used=false 로 넘겨 비교에서 뺀다.
 */
public final class CrossCheckEvaluator {

    private CrossCheckEvaluator() {
    }

    public enum Normalize { NONE, NUMBER, CURRENCY }

    /** 한 행의 입력. used* 는 TestQuery 가 그 출처를 지정했는지. */
    public record Input(boolean usedUi, String ui, boolean usedApi, String api, boolean usedDb, String db,
                        String expected, boolean consistencyOnly, Normalize normalize) {
    }

    public static Verdict evaluate(Input in) {
        List<String> values = new ArrayList<>();
        boolean missing = false;
        if (in.usedUi()) {
            missing |= in.ui() == null;
            values.add(in.ui());
        }
        if (in.usedApi()) {
            missing |= in.api() == null;
            values.add(in.api());
        }
        if (in.usedDb()) {
            missing |= in.db() == null;
            values.add(in.db());
        }
        if (values.isEmpty() || in.consistencyOnly() && values.size() == 1) {
            return Verdict.NOT_APPLICABLE;
        }
        if (missing) {
            return Verdict.MISMATCH;
        }
        List<String> normalized = values.stream().map(v -> normalize(v, in.normalize())).toList();
        if (normalized.stream().anyMatch(Objects::isNull) || normalized.stream().distinct().count() > 1) {
            return Verdict.MISMATCH;
        }
        if (in.consistencyOnly()) {
            return Verdict.MATCH;
        }
        String expected = normalize(in.expected(), in.normalize());
        return expected != null && expected.equals(normalized.get(0)) ? Verdict.MATCH : Verdict.MISMATCH;
    }

    /** 정규화. 숫자로 읽을 수 없는 값을 NUMBER·CURRENCY 로 정규화하면 null (= 불일치). */
    public static String normalize(String value, Normalize mode) {
        if (value == null) {
            return null;
        }
        String trimmed = value.strip();
        return switch (mode == null ? Normalize.NONE : mode) {
            case NONE -> trimmed;
            case NUMBER, CURRENCY -> {
                String digits = trimmed.replaceAll("[₩$€¥£,\\s]|원|KRW", "");
                try {
                    BigDecimal number = new BigDecimal(digits);
                    yield number.stripTrailingZeros().toPlainString();
                } catch (NumberFormatException ex) {
                    yield null;
                }
            }
        };
    }
}
