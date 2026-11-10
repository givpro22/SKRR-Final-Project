-- 로컬 개발 전용 예시 프로젝트 (profile: local). 운영 마이그레이션 경로에는 포함되지 않는다.
INSERT INTO project (id, name, created_by)
VALUES ('00000000-0000-0000-0000-0000000000a1', '목업 쇼핑몰 v1.2', '00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO knowledge_base (project_id)
VALUES ('00000000-0000-0000-0000-0000000000a1')
ON CONFLICT (project_id) DO NOTHING;
