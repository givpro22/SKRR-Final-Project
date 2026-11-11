-- V4__scenario_guard_case_analysis.sql (FR-02~07 사전 점검, ADR-022)
-- 원본: _workspace/02_contract-architect_changes.md. 시나리오 가드 실패 목록, 케이스 활성 여부, 실패 분석 상태.
ALTER TABLE scenario ADD COLUMN guard_failures JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE test_case ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE case_result ADD COLUMN analysis_status VARCHAR(20) NOT NULL DEFAULT 'NOT_REQUIRED'
    CHECK (analysis_status IN ('NOT_REQUIRED','PENDING','RUNNING','COMPLETED','FAILED'));
ALTER TABLE case_result ADD COLUMN analysis_error TEXT;
-- 작업을 다시 보낼 때 필요한 사용자 입력 (예: 시나리오 재생성 {"feedback": "..."}). 비밀값 금지
ALTER TABLE async_job ADD COLUMN request_payload JSONB;
