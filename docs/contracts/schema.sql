-- SKRR 플랫폼 DB 스키마 초안 v0.1 (PostgreSQL 16 기준)
-- 근거: harness/references 요구사항서, WBS 4.1.3, UI-01~UI-04 화면.
-- 구현 시 backend/src/main/resources/db/migration/V1__init.sql 로 옮긴다.
--
-- 규칙
--  * 상태값은 ENUM 타입 대신 VARCHAR + CHECK 로 둔다. JPA 매핑과 값 추가 마이그레이션이 단순하기 때문이다.
--  * 줄 끝의 "-- enum:Name" 주석은 OpenAPI 스키마 이름과의 대응 표시다.
--    check_contracts.py 가 두 값 목록이 같은지 대조하므로 지우지 않는다.
--  * 표시용 코드(REQ-0142, RUN-0318, SC-01, TC-12)는 내부 id(UUID)와 분리한다.

-- 사용자 ------------------------------------------------------------------
CREATE TABLE app_user (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name  VARCHAR(100) NOT NULL,
    role_label    VARCHAR(50)  NOT NULL DEFAULT 'QA 담당자',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 프로젝트 (UI-01 좌측 프로젝트 선택) ---------------------------------------
CREATE TABLE project (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(100) NOT NULL,
    target_url          VARCHAR(500),
    target_url_status   VARCHAR(20)  NOT NULL DEFAULT 'UNVERIFIED' CHECK (target_url_status IN ('UNVERIFIED','CHECKING','REACHABLE','UNREACHABLE')), -- enum:TargetUrlStatus
    target_checked_at   TIMESTAMPTZ,
    query_api_base_url  VARCHAR(500),          -- 대상 사이트의 읽기 전용 DB 조회 API
    test_control_url    VARCHAR(500),          -- 대상 사이트의 테스트 전용 초기화 API
    created_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 기준 문서 (UI-01, WBS 4.3.2) ----------------------------------------------
CREATE TABLE document (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id         UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    type               VARCHAR(20) NOT NULL CHECK (type IN ('REQUIREMENT','API_SPEC','CATALOG','TEST_DATA')), -- enum:DocumentType
    version            INTEGER NOT NULL,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    original_filename  VARCHAR(255) NOT NULL,
    s3_key             VARCHAR(1024) NOT NULL UNIQUE,
    content_type       VARCHAR(100) NOT NULL,
    size_bytes         BIGINT NOT NULL CHECK (size_bytes BETWEEN 0 AND 20971520), -- 20MB 제한 (UI-01)
    checksum_sha256    CHAR(64) NOT NULL,
    status             VARCHAR(20) NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED','INDEXING','INDEXED','REGISTERED','FAILED')), -- enum:DocumentStatus
    index_progress     SMALLINT NOT NULL DEFAULT 0 CHECK (index_progress BETWEEN 0 AND 100),
    summary            JSONB NOT NULL DEFAULT '{}'::jsonb, -- 예: {"requirementCount":42}, {"endpointCount":18}
    error_message      TEXT,
    uploaded_by        UUID REFERENCES app_user(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, type, version)
);
CREATE UNIQUE INDEX uq_document_active ON document (project_id, type) WHERE is_active;

-- RAG 지식 베이스 상태 (벡터 자체는 AI 서버의 sqlite-vec 파일에 있다) --------
CREATE TABLE knowledge_base (
    project_id        UUID PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
    status            VARCHAR(20) NOT NULL DEFAULT 'NOT_BUILT' CHECK (status IN ('NOT_BUILT','BUILDING','READY','STALE','FAILED')), -- enum:KnowledgeBaseStatus
    chunk_count       INTEGER NOT NULL DEFAULT 0,
    requirement_count INTEGER NOT NULL DEFAULT 0,
    api_count         INTEGER NOT NULL DEFAULT 0,
    ui_element_count  INTEGER NOT NULL DEFAULT 0,
    last_synced_at    TIMESTAMPTZ,
    error_message     TEXT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 최근 활동 (UI-01 우측) ----------------------------------------------------
CREATE TABLE activity_log (
    id          BIGSERIAL PRIMARY KEY,
    project_id  UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    message     VARCHAR(300) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_project_time ON activity_log (project_id, created_at DESC);

-- 테스트 요청 (UI-02-1, UI-02-1B) -------------------------------------------
CREATE TABLE test_request (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    seq               INTEGER NOT NULL,          -- 표시 코드 REQ-0142 의 숫자
    raw_text          VARCHAR(500) NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'REFINING' CHECK (status IN ('REFINING','AWAITING_SELECTION','GENERATING','GENERATED','FAILED')), -- enum:TestRequestStatus
    selection_source  VARCHAR(20) CHECK (selection_source IN ('CANDIDATE','CUSTOM')), -- enum:SelectionSource
    selected_text     TEXT,
    error_message     TEXT,
    created_by        UUID REFERENCES app_user(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, seq)
);

CREATE TABLE request_candidate (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_request_id  UUID NOT NULL REFERENCES test_request(id) ON DELETE CASCADE,
    ord              SMALLINT NOT NULL,
    refined_text     TEXT NOT NULL,
    references_json  JSONB NOT NULL DEFAULT '[]'::jsonb, -- RAG Top 3 근거
    is_selected      BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (test_request_id, ord)
);
CREATE UNIQUE INDEX uq_candidate_selected ON request_candidate (test_request_id) WHERE is_selected;

-- 시나리오·테스트 케이스 (UI-02-5) ------------------------------------------
CREATE TABLE scenario (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_request_id  UUID NOT NULL REFERENCES test_request(id) ON DELETE CASCADE,
    code             VARCHAR(20) NOT NULL,        -- SC-01 (요청 단위 번호)
    title            VARCHAR(200) NOT NULL,
    requirement_ref  VARCHAR(50),                 -- 대상 사이트 요구사항 ID. 예: FR-CART-01
    scopes           TEXT[] NOT NULL DEFAULT '{}' CHECK (scopes <@ ARRAY['UI','API','DB']::text[]), -- enum:VerificationScope
    status           VARCHAR(20) NOT NULL DEFAULT 'GENERATING' CHECK (status IN ('GENERATING','GUARD_RETRY','REVIEW_REQUIRED','APPROVED','REJECTED','GUARD_FAILED')), -- enum:ScenarioStatus
    guard_attempt    SMALLINT NOT NULL DEFAULT 0 CHECK (guard_attempt BETWEEN 0 AND 3),
    guard_message    TEXT,
    references_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
    version          INTEGER NOT NULL DEFAULT 1,  -- 내용이 바뀌면 증가, 승인은 초기화
    approved_by      UUID REFERENCES app_user(id),
    approved_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (test_request_id, code)
);

CREATE TABLE test_case (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id      UUID NOT NULL REFERENCES scenario(id) ON DELETE CASCADE,
    test_request_id  UUID NOT NULL REFERENCES test_request(id) ON DELETE CASCADE,
    code             VARCHAR(20) NOT NULL,        -- TC-12 (요청 단위 번호, UI-02-5와 UI-04가 같은 번호 사용)
    title            VARCHAR(200) NOT NULL,
    type             VARCHAR(20) NOT NULL CHECK (type IN ('NORMAL','EXCEPTION','BOUNDARY')), -- enum:TestCaseType
    scopes           TEXT[] NOT NULL DEFAULT '{}' CHECK (scopes <@ ARRAY['UI','API','DB']::text[]), -- enum:VerificationScope
    preconditions    JSONB NOT NULL DEFAULT '[]'::jsonb,
    steps            JSONB NOT NULL DEFAULT '[]'::jsonb,
    expected_result  TEXT NOT NULL,
    ord              SMALLINT NOT NULL,
    version          INTEGER NOT NULL DEFAULT 1,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (test_request_id, code)
);
CREATE INDEX idx_test_case_scenario ON test_case (scenario_id, ord);

-- 생성된 실행 정의 (WBS 4.6.1, FR-04). 실행기는 test_query 로만 실행한다 -----
CREATE TABLE generated_spec (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_case_id       UUID NOT NULL REFERENCES test_case(id) ON DELETE CASCADE,
    test_case_version  INTEGER NOT NULL,
    test_query         JSONB NOT NULL,
    spec_source        TEXT NOT NULL,
    renderer_version   VARCHAR(20) NOT NULL,
    compile_status     VARCHAR(20) NOT NULL CHECK (compile_status IN ('PASSED','FAILED')), -- enum:CompileStatus
    compile_error      TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (test_case_id, test_case_version, renderer_version)
);

-- 실행 (UI-03, WBS 4.3.9) ---------------------------------------------------
CREATE TABLE test_run (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id         UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    test_request_id    UUID NOT NULL REFERENCES test_request(id),
    seq                INTEGER NOT NULL,          -- 표시 코드 RUN-0318 의 숫자
    rerun_of_run_id    UUID REFERENCES test_run(id),
    status             VARCHAR(20) NOT NULL DEFAULT 'PREPARING' CHECK (status IN ('PREPARING','RUNNING','CANCELLING','PASSED','FAILED','CANCELLED','ERROR')), -- enum:RunStatus
    target_url         VARCHAR(500) NOT NULL,
    target_build       VARCHAR(50),               -- 대상 빌드 식별자 (UI-04: 빌드 a3f9c21)
    browser            VARCHAR(50) NOT NULL DEFAULT 'Chromium',
    viewport_width     INTEGER NOT NULL DEFAULT 1280,
    viewport_height    INTEGER NOT NULL DEFAULT 800,
    document_versions  JSONB NOT NULL DEFAULT '{}'::jsonb, -- {"REQUIREMENT":3,"API_SPEC":2,"CATALOG":2}
    error_message      TEXT,
    started_by         UUID REFERENCES app_user(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at         TIMESTAMPTZ,
    finished_at        TIMESTAMPTZ,
    UNIQUE (project_id, seq)
);
CREATE INDEX idx_run_project_time ON test_run (project_id, created_at DESC);

CREATE TABLE scenario_run (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id       UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    scenario_id  UUID NOT NULL REFERENCES scenario(id),
    ord          SMALLINT NOT NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','RUNNING','PASSED','FAILED','SKIPPED','CANCELLED')), -- enum:ScenarioRunStatus
    duration_ms  BIGINT,
    UNIQUE (run_id, scenario_id),
    UNIQUE (run_id, ord)
);

CREATE TABLE case_result (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_run_id     UUID NOT NULL REFERENCES scenario_run(id) ON DELETE CASCADE,
    test_case_id        UUID NOT NULL REFERENCES test_case(id),
    generated_spec_id   UUID REFERENCES generated_spec(id),
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','PASSED','FAILED','SKIPPED','CANCELLED','ERROR')), -- enum:CaseResultStatus
    attempts            SMALLINT NOT NULL DEFAULT 0,
    failed_attempts     SMALLINT NOT NULL DEFAULT 0,  -- UI-04 재현: "3회 중 3회"
    duration_ms         BIGINT,
    severity            VARCHAR(20) CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')), -- enum:Severity
    failure_type        VARCHAR(30) CHECK (failure_type IN ('DATA_MISMATCH','ASSERTION_FAILED','ELEMENT_NOT_FOUND','API_ERROR','API_SCHEMA_MISMATCH','TIMEOUT','ENVIRONMENT_ERROR','TEST_CODE_ERROR')), -- enum:FailureType
    failure_message     TEXT,
    failure_fingerprint VARCHAR(64),                  -- 이전 실행 대비(새로운 실패/계속 실패) 비교용
    affected_features   TEXT[] NOT NULL DEFAULT '{}',
    first_seen_run_id   UUID REFERENCES test_run(id),
    UNIQUE (scenario_run_id, test_case_id)
);

CREATE TABLE run_step (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_result_id  UUID NOT NULL REFERENCES case_result(id) ON DELETE CASCADE,
    attempt         SMALLINT NOT NULL DEFAULT 1,
    ord             SMALLINT NOT NULL,
    kind            VARCHAR(20) NOT NULL CHECK (kind IN ('SETUP','UI','API','DB','ASSERT','TEARDOWN')), -- enum:StepKind
    title           VARCHAR(300) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','PASSED','FAILED','SKIPPED')), -- enum:StepStatus
    detail          TEXT,
    expected_value  TEXT,
    actual_value    TEXT,
    schema_check    VARCHAR(20) CHECK (schema_check IN ('PASSED','FAILED','NOT_CHECKED')), -- enum:SchemaCheckStatus
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    UNIQUE (case_result_id, attempt, ord)
);

-- 화면·API·DB 교차 검증 (UI-04 표, WBS 4.3.7, 4.3.10) ------------------------
CREATE TABLE verification (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_result_id  UUID NOT NULL REFERENCES case_result(id) ON DELETE CASCADE,
    ord             SMALLINT NOT NULL,
    item_label      VARCHAR(200) NOT NULL,
    ui_value        TEXT,
    api_value       TEXT,
    db_value        TEXT,
    expected_value  TEXT,                 -- 없으면 값이 서로 같은지만 확인한 항목
    verdict         VARCHAR(20) NOT NULL CHECK (verdict IN ('MATCH','MISMATCH','NOT_APPLICABLE')), -- enum:Verdict
    UNIQUE (case_result_id, ord)
);

CREATE TABLE api_call (
    id              BIGSERIAL PRIMARY KEY,
    run_id          UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    case_result_id  UUID REFERENCES case_result(id) ON DELETE CASCADE,
    method          VARCHAR(10) NOT NULL,
    path            VARCHAR(1000) NOT NULL,
    status_code     SMALLINT,
    duration_ms     INTEGER,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_api_call_run ON api_call (run_id, id);

-- 실시간 이벤트 저장소. SSE 재연결(Last-Event-ID)과 로그 조회가 함께 쓴다 ---
CREATE TABLE run_event (
    seq         BIGSERIAL PRIMARY KEY,
    run_id      UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    type        VARCHAR(30) NOT NULL CHECK (type IN ('run.status','scenario.status','case.status','step.status','log','api.call','screenshot','verification','heartbeat')), -- enum:RunEventType
    payload     JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_run_event_run_seq ON run_event (run_id, seq);

-- 원인 후보 (UI-04, 성공 기준: 탐지 장애의 70%에서 실제 원인을 1순위로 제시) --
CREATE TABLE root_cause_candidate (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_result_id  UUID NOT NULL REFERENCES case_result(id) ON DELETE CASCADE,
    rank            SMALLINT NOT NULL,
    description     TEXT NOT NULL,
    confidence_pct  SMALLINT NOT NULL CHECK (confidence_pct BETWEEN 0 AND 100),
    evidence        JSONB NOT NULL DEFAULT '[]'::jsonb,
    remediation     TEXT,
    UNIQUE (case_result_id, rank)
);

-- 실행 증거 (UI-04, WBS 4.6.4). 파일 본문은 S3, 여기에는 위치만 둔다 ---------
CREATE TABLE artifact (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          UUID NOT NULL REFERENCES test_run(id) ON DELETE CASCADE,
    case_result_id  UUID REFERENCES case_result(id) ON DELETE CASCADE,
    type            VARCHAR(20) NOT NULL CHECK (type IN ('SCREENSHOT','TRACE','HAR','SPEC')), -- enum:ArtifactType
    s3_key          VARCHAR(1024) NOT NULL UNIQUE,
    content_type    VARCHAR(100) NOT NULL,
    size_bytes      BIGINT,
    label           VARCHAR(200),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_artifact_case ON artifact (case_result_id);

-- 비동기 작업 추적. 백엔드 재시작 후에도 진행 중인 AI 작업을 이어서 확인한다 --
CREATE TABLE async_job (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type             VARCHAR(30) NOT NULL CHECK (type IN ('KB_BUILD','REQUEST_REFINE','SCENARIO_GENERATE','TEST_QUERY_GENERATE','FAILURE_ANALYZE')), -- enum:JobType
    status           VARCHAR(20) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')), -- enum:JobStatus
    remote_job_id    VARCHAR(100),
    subject_type     VARCHAR(30) NOT NULL,
    subject_id       UUID NOT NULL,
    attempt          SMALLINT NOT NULL DEFAULT 1,
    error_message    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_async_job_subject ON async_job (subject_type, subject_id);
CREATE INDEX idx_async_job_open ON async_job (status) WHERE status IN ('QUEUED','RUNNING');
