-- V3__document_skipped_and_target_check.sql (2026-11-10 2차 결정, ADR-019, ADR-020)
-- 문서 상태 SKIPPED 추가, 대상 사이트 연결 확인 결과(상태 코드, 문장) 저장.
-- 원본: _workspace/02_contract-architect_changes.md. V1은 수정하지 않는다.
ALTER TABLE document DROP CONSTRAINT document_status_check;
ALTER TABLE document ADD CONSTRAINT document_status_check
    CHECK (status IN ('UPLOADED','INDEXING','INDEXED','REGISTERED','FAILED','SKIPPED'));
ALTER TABLE project ADD COLUMN target_check_status_code SMALLINT;
ALTER TABLE project ADD COLUMN target_check_message TEXT;
