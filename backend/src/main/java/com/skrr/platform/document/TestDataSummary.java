package com.skrr.platform.document;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.skrr.platform.common.error.ApiException;
import com.skrr.platform.common.error.ErrorCode;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * TEST_DATA 문서(seed_accounts.json 형태, target-site-contract.md) 검사와 요약.
 * 값은 읽지 않고 개수만 센다. 비밀값을 로그나 응답에 남기지 않기 위해서다.
 */
final class TestDataSummary {

    private TestDataSummary() {
    }

    static Map<String, Integer> summarize(ObjectMapper mapper, byte[] content) {
        JsonNode root;
        try {
            root = mapper.readTree(content);
        } catch (IOException ex) {
            throw invalid("JSON 형식이 아닙니다.");
        }
        if (root == null || !root.isObject()) {
            throw invalid("최상위가 JSON 객체여야 합니다.");
        }
        Map<String, Integer> summary = new LinkedHashMap<>();
        summary.put("variableCount", countObject(root, "variables"));
        summary.put("secretCount", countObject(root, "secrets"));
        return summary;
    }

    private static int countObject(JsonNode root, String field) {
        JsonNode node = root.get(field);
        if (node == null || node.isNull()) {
            return 0;
        }
        if (!node.isObject()) {
            throw invalid("'" + field + "'는 이름과 값의 객체여야 합니다.");
        }
        return node.size();
    }

    private static ApiException invalid(String reason) {
        return new ApiException(ErrorCode.VALIDATION_FAILED,
                "테스트 데이터 형식이 올바르지 않습니다. " + reason + " 예: {\"variables\":{...},\"secrets\":{...}}");
    }
}
