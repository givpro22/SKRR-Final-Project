-- 기본 사용자 1명 (ADR-011, ADR-013: 로그인 없음).
-- getCurrentUser, created_by, uploaded_by, started_by가 이 사용자를 쓴다.
-- id는 application.yml 의 skrr.default-user-id 와 같아야 한다.
INSERT INTO app_user (id, display_name, role_label)
VALUES ('00000000-0000-0000-0000-000000000001', '기본 사용자', 'QA 담당자')
ON CONFLICT (id) DO NOTHING;
