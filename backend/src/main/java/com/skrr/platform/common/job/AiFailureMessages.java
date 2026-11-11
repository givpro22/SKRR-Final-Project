package com.skrr.platform.common.job;

import com.skrr.platform.client.ai.AiJob;
import java.util.Set;

/** 사용자에게 보여 줄 AI 작업 실패 문장. 지식 베이스 문제면 재구축 안내를 붙인다 (state-machines.md TestRequest). */
public final class AiFailureMessages {

    private static final Set<String> KNOWLEDGE_BASE_CODES = Set.of("KNOWLEDGE_BASE_MISSING", "EMBEDDING_MODEL_MISMATCH");

    private AiFailureMessages() {
    }

    public static String forUser(String message, AiJob remote) {
        if (remote != null && remote.error() != null && KNOWLEDGE_BASE_CODES.contains(remote.error().code())) {
            return "지식 베이스를 다시 구축해 주세요. " + message;
        }
        return message;
    }
}
