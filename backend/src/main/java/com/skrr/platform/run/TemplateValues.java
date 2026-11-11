package com.skrr.platform.run;

import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** TestQuery 의 {{이름}} 참조 처리 (test-query.schema.json variables 설명). */
public final class TemplateValues {

    public static final Pattern REFERENCE = Pattern.compile("\\{\\{\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*}}");
    public static final String MASK = "***";

    private TemplateValues() {
    }

    /** 문자열 안의 {{이름}} 목록. */
    public static Set<String> references(String text) {
        Set<String> names = new LinkedHashSet<>();
        if (text != null) {
            Matcher m = REFERENCE.matcher(text);
            while (m.find()) {
                names.add(m.group(1));
            }
        }
        return names;
    }

    /**
     * {{이름}}을 변수 → 비밀 변수 → 캡처 순서로 채운다. masked 가 참이면 비밀 변수는 ***로 둔다(저장·표시용).
     * 찾지 못한 이름은 그대로 둔다.
     */
    public static String fill(String text, Map<String, String> variables, Map<String, String> secrets,
                              Map<String, String> captures, boolean masked) {
        if (text == null) {
            return null;
        }
        Matcher m = REFERENCE.matcher(text);
        StringBuilder out = new StringBuilder();
        while (m.find()) {
            String name = m.group(1);
            String value;
            if (variables.containsKey(name)) {
                value = variables.get(name);
            } else if (secrets.containsKey(name)) {
                value = masked ? MASK : secrets.get(name);
            } else if (captures.containsKey(name)) {
                value = captures.get(name);
            } else {
                value = m.group(0);
            }
            m.appendReplacement(out, Matcher.quoteReplacement(value));
        }
        m.appendTail(out);
        return out.toString();
    }
}
