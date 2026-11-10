package com.skrr.platform.client.ai;

/** 작업 조회 404. AI 서버가 재시작해 작업을 잃은 것으로 본다. */
public class AiJobNotFoundException extends RuntimeException {
    public AiJobNotFoundException(String jobId) {
        super("AI 작업을 찾을 수 없습니다: " + jobId);
    }
}
