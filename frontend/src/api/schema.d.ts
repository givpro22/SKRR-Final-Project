/**
 * 이 파일은 자동 생성된다. 직접 고치지 말고 `npm run generate:api`를 실행한다.
 * 원본: docs/contracts/platform-api.openapi.yaml
 */

export interface paths {
    "/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 현재 사용자 (사이드바 하단 프로필) */
        get: operations["getCurrentUser"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 프로젝트 목록 (사이드바 프로젝트 선택) */
        get: operations["listProjects"];
        put?: never;
        /** 프로젝트 생성 */
        post: operations["createProject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        /** 프로젝트 조회 */
        get: operations["getProject"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 프로젝트와 대상 사이트 URL 수정 (UI-01)
         * @description targetUrl이 바뀌면 targetUrlStatus는 UNVERIFIED로 돌아가고 targetCheckedAt, targetCheckStatusCode, targetCheckMessage는 null이 된다.
         */
        patch: operations["updateProject"];
        trace?: never;
    };
    "/projects/{projectId}/target-verification": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 대상 사이트 연결 확인 (UI-01 "연결 확인" 배지)
         * @description 실행기가 대상 URL에 HTTP GET을 보내 판정한다 (ADR-019, 판정 규칙은 target-site-contract.md "연결 확인").
         *     서버가 응답하면(2xx·3xx·4xx) REACHABLE, 5xx·연결 실패·시간 초과·허용 목록 밖이면 UNREACHABLE이다.
         *     결과(상태, 상태 코드, 문장)는 Project에 저장되어 새로고침해도 유지된다.
         *     targetUrl이 없으면 409 TARGET_URL_MISSING.
         */
        post: operations["verifyTargetSite"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}/documents": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        /** 현재 활성 기준 문서 목록 (UI-01) */
        get: operations["listDocuments"];
        put?: never;
        /**
         * 기준 문서 업로드 (FR-01, 20MB 이하)
         * @description 같은 유형의 기존 문서는 비활성화되고 version이 1 증가한다.
         *     업로드만으로는 인덱싱하지 않는다. 필수 문서는 UPLOADED("구축 대기")로 남고 buildKnowledgeBase 때 INDEXING이 된다 (ADR-018).
         *     TEST_DATA는 JSON 형식을 검사한 뒤 바로 REGISTERED가 된다.
         *
         *     문서 종류별 허용 확장자 (target-site-contract.md "문서 형식"). 다르면 400 UNSUPPORTED_FILE_TYPE + allowedExtensions.
         *     | type | 확장자 |
         *     |---|---|
         *     | REQUIREMENT | pdf, docx |
         *     | API_SPEC | yaml, yml, json |
         *     | CATALOG | csv, json |
         *     | TEST_DATA | json |
         *
         *     지식 베이스가 READY일 때 필수 문서(REQUIREMENT, API_SPEC, CATALOG)를 올리면 STALE이 된다.
         *     TEST_DATA의 업로드·교체·삭제는 지식 베이스 상태를 바꾸지 않는다 (AI 서버로 보내지 않으므로).
         */
        post: operations["uploadDocument"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/{documentId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                documentId: string;
            };
            cookie?: never;
        };
        /** 문서 조회 (인덱싱 진행률 포함) */
        get: operations["getDocument"];
        put?: never;
        post?: never;
        /**
         * 문서 삭제 (UI-01 더보기 메뉴)
         * @description 행과 파일을 지우며 이전 버전을 다시 활성화하지 않는다. 문서가 INDEXING이거나 지식 베이스가 BUILDING이면 409 INVALID_STATE_TRANSITION.
         *     READY일 때 활성 필수 문서를 지우면 STALE이 된다. TEST_DATA 삭제는 지식 베이스 상태를 바꾸지 않는다.
         */
        delete: operations["deleteDocument"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/documents/{documentId}/download-link": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                documentId: string;
            };
            cookie?: never;
        };
        /** 문서 다운로드 링크 (S3 presigned URL) */
        get: operations["getDocumentDownloadLink"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/document-templates/{documentType}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                documentType: components["schemas"]["DocumentType"];
            };
            cookie?: never;
        };
        /** 문서 템플릿 받기 (UI-01 "템플릿 받기") */
        get: operations["downloadDocumentTemplate"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}/knowledge-base": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        /** 지식 베이스 상태·미리보기·등록 요건 (UI-01 우측, 사이드바 하단) */
        get: operations["getKnowledgeBase"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}/knowledge-base/build": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 지식 베이스 구축 (UI-01 "지식 베이스 구축")
         * @description 필수 문서 3종이 없으면 409 MISSING_REQUIRED_DOCUMENTS와 본문 missingDocumentTypes를 반환한다 (FR-01 수용기준).
         *     지식 베이스가 BUILDING이면 409 INVALID_STATE_TRANSITION.
         *     구축을 시작하면 활성 필수 문서 3종이 모두 INDEXING이 된다(UPLOADED·INDEXED·FAILED·SKIPPED에서). AI 서버가 전체를 다시 인덱싱하기 때문이다.
         *     TEST_DATA는 AI 서버로 보내지 않으며 상태가 바뀌지 않는다. 문서별 결과 규칙은 state-machines.md Document를 따른다.
         */
        post: operations["buildKnowledgeBase"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}/activities": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        /** 최근 활동 (UI-01 우측) */
        get: operations["listActivities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}/test-requests": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        /** 테스트 요청 목록 (사이드바 "테스트 요청") */
        get: operations["listTestRequests"];
        put?: never;
        /**
         * 자연어 테스트 요청 생성 (UI-02-1, FR-02)
         * @description 지식 베이스가 READY가 아니면(NOT_BUILT, BUILDING, STALE, FAILED) 409 KNOWLEDGE_BASE_NOT_READY를 반환한다.
         *     text는 앞뒤 공백을 지운 뒤 1~500자다. 202 뒤 상태는 REFINING이고, AI 서버 정제가 끝나면 AWAITING_SELECTION(후보 채워짐), 실패하면 FAILED(errorMessage)다.
         */
        post: operations["createTestRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/test-requests/{testRequestId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                testRequestId: components["parameters"]["TestRequestId"];
            };
            cookie?: never;
        };
        /** 요청과 후보 조회 (UI-02-1B). 생성 중에는 2초 간격으로 조회한다. */
        get: operations["getTestRequest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/test-requests/{testRequestId}/selection": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                testRequestId: components["parameters"]["TestRequestId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 후보 1개 선택 또는 직접 입력 후 시나리오 생성 시작 (UI-02-1B, WBS 4.5.6)
         * @description 요청이 AWAITING_SELECTION일 때만 받는다. 아니면 409 INVALID_STATE_TRANSITION.
         *     candidateId가 이 요청의 후보가 아니면 400 VALIDATION_FAILED. 202 뒤 상태는 GENERATING, 끝나면 GENERATED이고 scenarioCount, testCaseCount가 채워진다.
         *     시나리오는 생성 작업이 끝날 때 한꺼번에 만들어진다 (state-machines.md TestRequest).
         */
        post: operations["selectRefinedRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/test-requests/{testRequestId}/scenarios": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                testRequestId: components["parameters"]["TestRequestId"];
            };
            cookie?: never;
        };
        /** 시나리오·케이스 조회 (UI-02-5) */
        get: operations["listScenarios"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/scenarios/{scenarioId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scenarioId: components["parameters"]["ScenarioId"];
            };
            cookie?: never;
        };
        /** 시나리오 조회 */
        get: operations["getScenario"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 시나리오 수정 (UI-02-5 연필 아이콘)
         * @description 내용이 바뀌면 version이 증가하고 상태는 REVIEW_REQUIRED로 돌아간다 (APPROVED였으면 승인 해제).
         *     GENERATING, GUARD_RETRY 중에는 409 INVALID_STATE_TRANSITION.
         */
        patch: operations["updateScenario"];
        trace?: never;
    };
    "/scenarios/{scenarioId}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scenarioId: components["parameters"]["ScenarioId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 시나리오 승인 (FR-03)
         * @description REVIEW_REQUIRED일 때만 승인한다. 다른 상태면 409 INVALID_STATE_TRANSITION.
         */
        post: operations["approveScenario"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/scenarios/{scenarioId}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scenarioId: components["parameters"]["ScenarioId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 시나리오 반려
         * @description REVIEW_REQUIRED일 때만 반려한다. 다른 상태면 409 INVALID_STATE_TRANSITION.
         */
        post: operations["rejectScenario"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/scenarios/{scenarioId}/regenerate": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scenarioId: components["parameters"]["ScenarioId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 시나리오 재생성
         * @description REVIEW_REQUIRED, APPROVED, REJECTED, GUARD_FAILED에서 받는다. GENERATING, GUARD_RETRY 중이면 409 INVALID_STATE_TRANSITION.
         *     시나리오 코드(SC-xx)는 유지하고 version이 증가한다. 기존 케이스는 비활성화되고 새 케이스는 요청 안에서 쓰지 않은 새 TC 번호를 받는다.
         */
        post: operations["regenerateScenario"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/test-cases/{testCaseId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                testCaseId: string;
            };
            cookie?: never;
        };
        /** 테스트 케이스 상세 (UI-02-5 행 펼치기) */
        get: operations["getTestCase"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 테스트 케이스 수정
         * @description 소속 시나리오의 승인이 해제되어 REVIEW_REQUIRED로 돌아간다. 시나리오가 GENERATING, GUARD_RETRY이거나 케이스가 비활성이면 409 INVALID_STATE_TRANSITION.
         *     expectedValues 각 항목은 expected와 consistencyOnly(true) 중 하나만 갖고, consistencyOnly면 reason이 필요하다. 어기면 400 VALIDATION_FAILED.
         */
        patch: operations["updateTestCase"];
        trace?: never;
    };
    "/test-requests/{testRequestId}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                testRequestId: components["parameters"]["TestRequestId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 체크한 승인 시나리오로 테스트 실행 (UI-02-5 "테스트 실행", FR-04, FR-05)
         * @description - scenarioIds가 이 요청의 시나리오가 아니면 400 VALIDATION_FAILED
         *     - 승인되지 않은 시나리오가 포함되면 409 SCENARIO_NOT_APPROVED
         *     - 플랫폼 어디든 진행 중인 실행(PREPARING, RUNNING, CANCELLING)이 있으면 409 RUN_ALREADY_ACTIVE (state-machines.md Run, ADR-023 U3)
         *     - 프로젝트에 targetUrl이 없으면 409 TARGET_URL_MISSING
         *     202 뒤 상태는 PREPARING이다. 이때 케이스별 TestQuery 생성과 spec 변환을 하고, 끝나면 RUNNING이 된다.
         *     대상 사이트·실행기 장애는 시작을 거부하지 않고 실행을 ERROR로 끝낸다.
         */
        post: operations["startRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        /** 실행 목록 (사이드바 "실행 모니터", "리포트") */
        get: operations["listRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{runId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        /** 실행 현재 상태 스냅샷 (UI-03 첫 진입과 SSE 재연결 시 사용) */
        get: operations["getRun"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{runId}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 실행 중단 (UI-03 "실행 중단")
         * @description PREPARING, RUNNING일 때 CANCELLING으로 바꾼다. 이미 끝났거나 CANCELLING이면 409 INVALID_STATE_TRANSITION.
         */
        post: operations["cancelRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{runId}/rerun": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 실패 건 또는 특정 케이스 재실행 (UI-04 "실패 2건 재실행", "이 케이스 재실행")
         * @description 새 실행(rerunOfRunId = 원래 실행)을 만든다. 원래 실행이 끝나지 않았으면 409 RUN_NOT_FINISHED, 플랫폼 어디든 진행 중인 실행이 있으면 409 RUN_ALREADY_ACTIVE.
         *     대상 케이스의 시나리오가 지금 APPROVED가 아니면 409 SCENARIO_NOT_APPROVED. caseResultIds가 이 실행의 것이 아니거나 중복이거나, 대상 케이스가 시나리오 재생성으로 비활성이 됐거나, 비웠는데 FAILED 케이스가 없으면 400 VALIDATION_FAILED.
         *     프로젝트에 targetUrl이 없으면 409 TARGET_URL_MISSING (startRun과 같음).
         *     케이스 내용(version)이 그대로면 저장된 TestQuery를 다시 쓰고(AI 호출 없음), spec은 실행 전에 다시 변환한다 (state-machines.md Run).
         */
        post: operations["rerunRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{runId}/events": {
        parameters: {
            query?: {
                /** @description 첫 연결에 사용한다. 브라우저 EventSource는 첫 요청에 헤더를 지정할 수 없기 때문이다. 스냅샷의 lastEventSeq를 넣는다. */
                afterSeq?: number;
            };
            header?: {
                /** @description 재연결 시 브라우저가 자동으로 보낸다. afterSeq와 함께 오면 이 값을 우선한다. */
                "Last-Event-ID"?: string;
            };
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        /** 실행 실시간 이벤트 SSE (UI-03, WBS 4.3.6). 형식은 docs/contracts/events.md */
        get: operations["streamRunEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{runId}/logs": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        /** 저장된 실행 로그 조회 */
        get: operations["listRunLogs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{runId}/api-calls": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        /** API 호출 목록과 집계 (UI-03 "API 호출" 패널) */
        get: operations["listRunApiCalls"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{runId}/report": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        /**
         * 결과 리포트 (UI-04, FR-06, FR-07)
         * @description 실행이 끝나기 전에는 409 RUN_NOT_FINISHED를 반환한다.
         *     실패 원인 분석은 실행이 끝난 뒤 비동기로 진행되므로 리포트는 분석 완료 전에도 받을 수 있다. 케이스별 분석 상태는 getCaseResult의 analysisStatus로 본다.
         */
        get: operations["getRunReport"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{runId}/report.pdf": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        /** 리포트 PDF 내보내기 (UI-04). WBS에 작업이 없어 MVP 이후 항목이다. */
        get: operations["exportRunReportPdf"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/case-results/{caseResultId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                caseResultId: components["parameters"]["CaseResultId"];
            };
            cookie?: never;
        };
        /** 실패 케이스 상세 (UI-04 우측 패널) */
        get: operations["getCaseResult"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/case-results/{caseResultId}/spec": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                caseResultId: components["parameters"]["CaseResultId"];
            };
            cookie?: never;
        };
        /**
         * 실행한 Playwright spec 코드 (UI-03 "spec 코드 보기", UI-04 실행 증거)
         * @description 아직 TestQuery 생성·변환 전이면(PREPARING 중이거나 생성 실패) 404 RESOURCE_NOT_FOUND. 비밀값은 spec에 들어 있지 않다.
         */
        get: operations["getCaseResultSpec"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/artifacts/{artifactId}/download-link": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                artifactId: string;
            };
            cookie?: never;
        };
        /** 실행 증거 링크 (스크린샷, trace, HAR) */
        get: operations["getArtifactDownloadLink"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Problem: {
            type?: string;
            title: string;
            status: number;
            detail?: string;
            /** @description 요청 경로 */
            instance?: string;
            code: components["schemas"]["ErrorCode"];
            /** @description 409 MISSING_REQUIRED_DOCUMENTS일 때만. 빠진 필수 문서 종류 */
            missingDocumentTypes?: components["schemas"]["DocumentType"][];
            /** @description 400 UNSUPPORTED_FILE_TYPE일 때만. 해당 문서 종류의 허용 확장자 (소문자, 점 없음) */
            allowedExtensions?: string[];
            fieldErrors?: {
                field: string;
                message: string;
            }[];
        };
        /** @enum {string} */
        ErrorCode: "VALIDATION_FAILED" | "RESOURCE_NOT_FOUND" | "FILE_TOO_LARGE" | "UNSUPPORTED_FILE_TYPE" | "TARGET_URL_MISSING" | "MISSING_REQUIRED_DOCUMENTS" | "KNOWLEDGE_BASE_NOT_READY" | "INVALID_STATE_TRANSITION" | "SCENARIO_NOT_APPROVED" | "RUN_NOT_FINISHED" | "RUN_ALREADY_ACTIVE" | "DEPENDENCY_UNAVAILABLE" | "INTERNAL_ERROR";
        /** @enum {string} */
        TargetUrlStatus: "UNVERIFIED" | "CHECKING" | "REACHABLE" | "UNREACHABLE";
        /** @enum {string} */
        DocumentType: "REQUIREMENT" | "API_SPEC" | "CATALOG" | "TEST_DATA";
        /** @enum {string} */
        DocumentStatus: "UPLOADED" | "INDEXING" | "INDEXED" | "REGISTERED" | "FAILED" | "SKIPPED";
        /** @enum {string} */
        KnowledgeBaseStatus: "NOT_BUILT" | "BUILDING" | "READY" | "STALE" | "FAILED";
        /** @enum {string} */
        TestRequestStatus: "REFINING" | "AWAITING_SELECTION" | "GENERATING" | "GENERATED" | "FAILED";
        /** @enum {string} */
        SelectionSource: "CANDIDATE" | "CUSTOM";
        /** @enum {string} */
        ScenarioStatus: "GENERATING" | "GUARD_RETRY" | "REVIEW_REQUIRED" | "APPROVED" | "REJECTED" | "GUARD_FAILED";
        /** @enum {string} */
        VerificationScope: "UI" | "API" | "DB";
        /** @enum {string} */
        TestCaseType: "NORMAL" | "EXCEPTION" | "BOUNDARY";
        /** @enum {string} */
        CompileStatus: "PASSED" | "FAILED";
        /** @enum {string} */
        RunStatus: "PREPARING" | "RUNNING" | "CANCELLING" | "PASSED" | "FAILED" | "CANCELLED" | "ERROR";
        /** @enum {string} */
        ScenarioRunStatus: "WAITING" | "RUNNING" | "PASSED" | "FAILED" | "ERROR" | "SKIPPED" | "CANCELLED";
        /** @enum {string} */
        CaseResultStatus: "PENDING" | "RUNNING" | "PASSED" | "FAILED" | "SKIPPED" | "CANCELLED" | "ERROR";
        /** @enum {string} */
        StepKind: "SETUP" | "UI" | "API" | "DB" | "ASSERT" | "TEARDOWN";
        /** @enum {string} */
        StepStatus: "PENDING" | "RUNNING" | "PASSED" | "FAILED" | "SKIPPED";
        /**
         * @description 실패 원인 분석 상태. FAILED 케이스만 분석한다 (state-machines.md "실패 원인 분석")
         * @enum {string}
         */
        AnalysisStatus: "NOT_REQUIRED" | "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
        /**
         * @description CATALOG_GAP은 재생성으로 해결되지 않으므로 카탈로그 수정이 필요하다는 뜻이다 (WBS 4.5.5).
         * @enum {string}
         */
        GuardFailureKind: "SCHEMA_INVALID" | "UNKNOWN_REQUIREMENT" | "UNKNOWN_API" | "UNKNOWN_TEST_ID" | "UNKNOWN_VARIABLE" | "NO_ASSERTION" | "MISSING_EXPECTED" | "EXPECTED_NOT_APPROVED" | "CATALOG_GAP";
        /** @enum {string} */
        Verdict: "MATCH" | "MISMATCH" | "NOT_APPLICABLE";
        /** @enum {string} */
        SchemaCheckStatus: "PASSED" | "FAILED" | "NOT_CHECKED";
        /** @enum {string} */
        Severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
        /** @enum {string} */
        FailureType: "DATA_MISMATCH" | "ASSERTION_FAILED" | "ELEMENT_NOT_FOUND" | "API_ERROR" | "API_SCHEMA_MISMATCH" | "TIMEOUT" | "ENVIRONMENT_ERROR" | "TEST_CODE_ERROR";
        /** @enum {string} */
        ArtifactType: "SCREENSHOT" | "TRACE" | "HAR" | "SPEC";
        /** @enum {string} */
        RunEventType: "run.status" | "scenario.status" | "case.status" | "step.status" | "log" | "api.call" | "screenshot" | "verification" | "heartbeat";
        User: {
            /** Format: uuid */
            id: string;
            displayName: string;
            roleLabel: string;
        };
        Project: {
            /** Format: uuid */
            id: string;
            /** @example 목업 쇼핑몰 v1.2 */
            name: string;
            /** Format: uri */
            targetUrl?: string | null;
            targetUrlStatus: components["schemas"]["TargetUrlStatus"];
            /** Format: date-time */
            targetCheckedAt?: string | null;
            /** @description 마지막 연결 확인에서 대상 서버가 돌려준 HTTP 상태 코드. 응답이 없었으면(연결 실패, 시간 초과, 허용 목록 밖) null */
            targetCheckStatusCode?: number | null;
            /** @description 마지막 연결 확인 결과 문장. UNREACHABLE이면 실패 사유. 확인 전이거나 targetUrl이 바뀌면 null */
            targetCheckMessage?: string | null;
            /** Format: uri */
            queryApiBaseUrl?: string | null;
            /** Format: uri */
            testControlUrl?: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        ProjectCreate: {
            name: string;
            /** Format: uri */
            targetUrl?: string;
            /** Format: uri */
            queryApiBaseUrl?: string;
            /** Format: uri */
            testControlUrl?: string;
        };
        ProjectUpdate: {
            name?: string;
            /** Format: uri */
            targetUrl?: string;
            /** Format: uri */
            queryApiBaseUrl?: string;
            /** Format: uri */
            testControlUrl?: string;
        };
        TargetVerification: {
            status: components["schemas"]["TargetUrlStatus"];
            /** Format: date-time */
            checkedAt: string;
            /** @description 대상 서버의 HTTP 상태 코드. 응답이 없었으면 null. Project.targetCheckStatusCode와 같은 값 */
            statusCode?: number | null;
            /** @description Project.targetCheckMessage와 같은 값 */
            message?: string | null;
        };
        Document: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            projectId: string;
            type: components["schemas"]["DocumentType"];
            version: number;
            isActive: boolean;
            originalFilename: string;
            contentType: string;
            /** Format: int64 */
            sizeBytes: number;
            status: components["schemas"]["DocumentStatus"];
            indexProgress: number;
            /**
             * @description UI-01 행 설명에 표시하는 개수. 키는 문서 종류별로 아래와 같다. 값이 없으면 빈 객체다.
             *     REQUIREMENT requirementCount, API_SPEC endpointCount, CATALOG elementCount·pageCount (AI 서버가 만듦),
             *     TEST_DATA variableCount·secretCount (백엔드가 만듦). 화면은 모르는 키를 이름 그대로 보여 준다.
             */
            summary: {
                /** @description 요구사항 수 (REQUIREMENT) */
                requirementCount?: number;
                /** @description 엔드포인트 수 (API_SPEC) */
                endpointCount?: number;
                /** @description 화면 요소 수 (CATALOG) */
                elementCount?: number;
                /** @description 화면 수 (CATALOG) */
                pageCount?: number;
                /** @description 변수 수 (TEST_DATA) */
                variableCount?: number;
                /** @description 비밀값 수 (TEST_DATA) */
                secretCount?: number;
            } & {
                [key: string]: number;
            };
            errorMessage?: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        DownloadLink: {
            /** Format: uri */
            url: string;
            /** Format: date-time */
            expiresAt: string;
        };
        /** @description 판정 기준은 state-machines.md "등록 요건 판정"을 따른다. */
        ReadinessItem: {
            /**
             * @example TARGET_REACHABLE
             * @example REQUIREMENT_ID_FORMAT
             * @example READ_ONLY_QUERY_API
             * @example CATALOG_TESTID_MAPPED
             */
            key: string;
            label: string;
            satisfied: boolean;
        };
        KnowledgeBase: {
            /** Format: uuid */
            projectId: string;
            status: components["schemas"]["KnowledgeBaseStatus"];
            chunkCount: number;
            requirementCount: number;
            apiCount: number;
            uiElementCount: number;
            /** Format: date-time */
            lastSyncedAt?: string | null;
            errorMessage?: string | null;
            /** @description UI-01 "등록 요건" 체크리스트 */
            readiness: components["schemas"]["ReadinessItem"][];
            missingDocumentTypes: components["schemas"]["DocumentType"][];
            canBuild: boolean;
        };
        Activity: {
            /** Format: int64 */
            id: number;
            message: string;
            /** Format: date-time */
            createdAt: string;
        };
        TestRequestCreate: {
            text: string;
        };
        RetrievedReference: {
            sourceType: components["schemas"]["DocumentType"];
            /** @example FR-CART-03 */
            sourceId: string;
            title?: string | null;
            excerpt: string;
            score: number;
        };
        RequestCandidate: {
            /** Format: uuid */
            id: string;
            order: number;
            refinedText: string;
            references: components["schemas"]["RetrievedReference"][];
        };
        TestRequest: {
            /** Format: uuid */
            id: string;
            /** @example REQ-0142 */
            code: string;
            /** Format: uuid */
            projectId: string;
            rawText: string;
            status: components["schemas"]["TestRequestStatus"];
            selectionSource?: components["schemas"]["SelectionSource"] | null;
            selectedText?: string | null;
            candidates: components["schemas"]["RequestCandidate"][];
            /** @description 생성 완료 모달의 시나리오 수 */
            scenarioCount: number;
            /** @description 생성 완료 모달의 테스트 케이스 수 */
            testCaseCount: number;
            errorMessage?: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        /** @description candidateId와 customText 중 하나만 보낸다. */
        SelectionRequest: {
            /** Format: uuid */
            candidateId: string;
        } | {
            customText: string;
        };
        GuardState: {
            attempt: number;
            /** @constant */
            maxAttempts: 3;
            /** @description 예: 카탈로그에 'cart-remove-button' 요소가 없어 재생성 중 */
            message?: string | null;
            /** @description 가드 실패에 CATALOG_GAP이 있음. GUARD_FAILED 화면에 카탈로그 수정 필요를 표시한다 */
            catalogGap: boolean;
            /** @description 마지막 AI 생성의 가드 실패 목록. 통과했으면 빈 배열. 사람이 수정해 REVIEW_REQUIRED가 돼도 지우지 않는다 (state-machines.md Scenario) */
            failures: {
                kind: components["schemas"]["GuardFailureKind"];
                message: string;
                /** @example cart-remove-button */
                subject?: string | null;
            }[];
        };
        /** @description 사용자가 승인하는 검증 항목과 기대값 (ADR-017). expected와 consistencyOnly(true) 중 하나만 쓰고, consistencyOnly면 reason이 필수다. 백엔드가 검사해 어기면 400 VALIDATION_FAILED. */
        ExpectedValue: {
            /** @example 무선 이어폰 수량 */
            label: string;
            /** @example 3 */
            expected?: string;
            consistencyOnly?: boolean;
            /** @description consistencyOnly를 쓴 이유 */
            reason?: string;
        };
        TestCase: {
            /** Format: uuid */
            id: string;
            /** @example TC-12 */
            code: string;
            /** Format: uuid */
            scenarioId: string;
            title: string;
            type: components["schemas"]["TestCaseType"];
            scopes: components["schemas"]["VerificationScope"][];
            preconditions?: string[];
            steps?: string[];
            expectedResult: string;
            expectedValues: components["schemas"]["ExpectedValue"][];
            order: number;
            version: number;
            /** @description 시나리오 재생성으로 대체되면 false. 목록(listScenarios)에는 활성 케이스만 나온다 */
            isActive: boolean;
        };
        TestCaseUpdate: {
            title?: string;
            type?: components["schemas"]["TestCaseType"];
            scopes?: components["schemas"]["VerificationScope"][];
            preconditions?: string[];
            steps?: string[];
            expectedResult?: string;
            expectedValues?: components["schemas"]["ExpectedValue"][];
        };
        Scenario: {
            /** Format: uuid */
            id: string;
            /** @example SC-01 */
            code: string;
            /** Format: uuid */
            testRequestId: string;
            title: string;
            /** @example FR-CART-01 */
            requirementRef?: string | null;
            scopes: components["schemas"]["VerificationScope"][];
            status: components["schemas"]["ScenarioStatus"];
            guard: components["schemas"]["GuardState"];
            references?: components["schemas"]["RetrievedReference"][];
            version: number;
            /** Format: date-time */
            approvedAt?: string | null;
            /** @description 활성 케이스 수 */
            caseCount: number;
            testCases: components["schemas"]["TestCase"][];
        };
        ScenarioUpdate: {
            title?: string;
            /**
             * @description 대상 사이트 요구사항 ID(예 FR-CART-01). null을 보내면 지운다. 보내지 않으면 그대로 둔다.
             *     Scenario.requirementRef와 AI GeneratedScenario.requirementRef처럼 근거 요구사항이 없는 시나리오도 허용한다.
             *     백엔드는 길이만 검사하고 지식 베이스에 있는 ID인지는 검사하지 않는다(가드 UNKNOWN_REQUIREMENT는 AI 생성 결과에만 적용).
             *     바뀌면 내용 변경으로 보아 version이 오르고 REVIEW_REQUIRED가 된다.
             */
            requirementRef?: string | null;
            scopes?: components["schemas"]["VerificationScope"][];
        };
        ScenarioList: {
            testRequest: components["schemas"]["TestRequest"];
            /** @description UI-02-5 범례. 상태별 시나리오 수이며 합이 total이다 */
            summary: {
                total: number;
                approved: number;
                reviewRequired: number;
                guardRetry: number;
                generating: number;
                rejected: number;
                guardFailed: number;
            };
            items: components["schemas"]["Scenario"][];
        };
        RunCreate: {
            scenarioIds: string[];
        };
        /** @description caseResultIds를 비우면 FAILED 케이스 전체를 재실행한다 (UI-04 "실패 N건 재실행"). ERROR 케이스는 caseResultIds로 지정해 재실행한다. */
        RerunRequest: {
            caseResultIds?: string[];
        };
        Run: {
            /** Format: uuid */
            id: string;
            /** @example RUN-0318 */
            code: string;
            /** Format: uuid */
            projectId: string;
            /** Format: uuid */
            testRequestId: string;
            /** Format: uuid */
            rerunOfRunId?: string | null;
            status: components["schemas"]["RunStatus"];
            /** Format: uri */
            targetUrl: string;
            targetBuild?: string | null;
            /**
             * @description 브라우저 이름과 버전 (실행기 Execution.browserVersion). UI-04 환경 표시
             * @example Chromium 130
             */
            browser: string;
            viewportWidth: number;
            viewportHeight: number;
            documentVersions: {
                [key: string]: number;
            };
            startedBy?: components["schemas"]["User"] | null;
            errorMessage?: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            startedAt?: string | null;
            /** Format: date-time */
            finishedAt?: string | null;
        };
        RunStep: {
            /** Format: uuid */
            id: string;
            order: number;
            attempt: number;
            kind: components["schemas"]["StepKind"];
            title: string;
            status: components["schemas"]["StepStatus"];
            detail?: string | null;
            expectedValue?: string | null;
            actualValue?: string | null;
            /** @description API 단계의 응답 구조 검사 결과. 세부 내용은 detail에 있다. */
            schemaCheck?: components["schemas"]["SchemaCheckStatus"] | null;
        };
        CaseRunSummary: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            testCaseId: string;
            /** @example TC-12 */
            code: string;
            title: string;
            status: components["schemas"]["CaseResultStatus"];
            attempts: number;
            failedAttempts: number;
            /** Format: int64 */
            durationMs?: number | null;
            /** @description 현재 또는 마지막 시도의 단계. UI-03 진행 목록에 사용한다. */
            steps?: components["schemas"]["RunStep"][];
        };
        ScenarioRun: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            scenarioId: string;
            /** @example SC-03 */
            code: string;
            title: string;
            requirementRef?: string | null;
            order: number;
            status: components["schemas"]["ScenarioRunStatus"];
            /** Format: int64 */
            durationMs?: number | null;
            cases: components["schemas"]["CaseRunSummary"][];
        };
        RunDetail: components["schemas"]["Run"] & {
            /** @description 시나리오 단위 집계. passed+failed+error+skipped+cancelled = finishedScenarios, finishedScenarios+running+waiting = totalScenarios */
            progress: {
                totalScenarios: number;
                finishedScenarios: number;
                passed: number;
                failed: number;
                error: number;
                skipped: number;
                cancelled: number;
                running: number;
                waiting: number;
            };
            scenarioRuns: components["schemas"]["ScenarioRun"][];
            /** Format: uuid */
            latestScreenshotArtifactId?: string | null;
            /** @example /checkout */
            currentPath?: string | null;
            /**
             * Format: int64
             * @description 이 값을 streamRunEvents의 afterSeq로 보내면 스냅샷 이후 이벤트만 받는다.
             */
            lastEventSeq: number;
        };
        RunLogEntry: {
            /** Format: int64 */
            seq: number;
            kind: components["schemas"]["StepKind"];
            message: string;
            /** Format: date-time */
            occurredAt: string;
        };
        ApiCall: {
            /** Format: int64 */
            id: number;
            /** @example POST */
            method: string;
            /** @example /orders */
            path: string;
            statusCode?: number | null;
            durationMs?: number | null;
            /** Format: date-time */
            occurredAt: string;
        };
        ReportCaseItem: {
            /** Format: uuid */
            caseResultId: string;
            code: string;
            title: string;
            status: components["schemas"]["CaseResultStatus"];
            attempts: number;
            failedAttempts: number;
            /** Format: int64 */
            durationMs?: number | null;
        };
        ReportScenario: {
            /** Format: uuid */
            scenarioRunId: string;
            code: string;
            title: string;
            requirementRef?: string | null;
            status: components["schemas"]["ScenarioRunStatus"];
            /** Format: int64 */
            durationMs?: number | null;
            passedCases: number;
            totalCases: number;
            cases: components["schemas"]["ReportCaseItem"][];
        };
        /** @description 비교 규칙은 state-machines.md "이전 실행 대비". 비교할 이전 실행이 없으면 previousRunCode가 null이고 세 목록은 빈 배열이다. */
        RunComparison: {
            /** @example RUN-0317 */
            previousRunCode?: string | null;
            newFailures: string[];
            continuingFailures: string[];
            resolved: string[];
            previousCasePassRatePct?: number | null;
        };
        RunReport: {
            run: components["schemas"]["Run"];
            kpis: {
                scenariosPassed: number;
                scenariosTotal: number;
                casesPassed: number;
                casesTotal: number;
                /** @description casesPassed / casesTotal × 100 반올림. casesTotal은 이 실행에 포함된 모든 케이스(ERROR, SKIPPED, CANCELLED 포함) */
                casePassRatePct: number;
                failedCases: number;
                /** @description 환경 문제로 판정하지 못한 케이스. 실패 수에 넣지 않는다. */
                errorCases: number;
                crossCheckMismatches: number;
                /** Format: int64 */
                durationMs: number;
                apiCallCount: number;
            };
            scenarios: components["schemas"]["ReportScenario"][];
            /** @description 선택되지 않아 실행하지 않은 시나리오. UI-04 안내 문구에 사용한다. */
            skippedScenarios: {
                code: string;
                status: components["schemas"]["ScenarioStatus"];
            }[];
            comparison: components["schemas"]["RunComparison"];
        };
        Verification: {
            order: number;
            /** @example 결제 합계 금액 */
            itemLabel: string;
            uiValue?: string | null;
            apiValue?: string | null;
            dbValue?: string | null;
            /** @description 없으면 값이 서로 같은지만 확인한 항목이다. */
            expectedValue?: string | null;
            verdict: components["schemas"]["Verdict"];
        };
        RootCauseCandidate: {
            rank: number;
            description: string;
            confidencePct: number;
            /** @description 실행 로그나 API 호출 등 실제 수집한 값에 근거한 문장 */
            evidence: string[];
            remediation?: string | null;
        };
        ArtifactRef: {
            /** Format: uuid */
            id: string;
            type: components["schemas"]["ArtifactType"];
            label?: string | null;
            /** Format: int64 */
            sizeBytes?: number | null;
            /** Format: date-time */
            createdAt: string;
        };
        CaseResultDetail: {
            /** Format: uuid */
            id: string;
            code: string;
            title: string;
            scenarioCode: string;
            scenarioTitle: string;
            requirementRef?: string | null;
            status: components["schemas"]["CaseResultStatus"];
            attempts: number;
            failedAttempts: number;
            /** Format: int64 */
            durationMs?: number | null;
            /** @description AI 분석 결과. 분석 전이면 null */
            severity?: components["schemas"]["Severity"] | null;
            /** @description 규칙으로 정한 실패 유형(실행기 결과와 교차 검증). AI 분석은 이 값을 바꾸지 않는다 */
            failureType?: components["schemas"]["FailureType"] | null;
            failureMessage?: string | null;
            analysisStatus: components["schemas"]["AnalysisStatus"];
            /** @description analysisStatus가 FAILED일 때 사유 */
            analysisError?: string | null;
            /** @description AI 분석 결과. 분석 전이면 빈 배열 */
            affectedFeatures: string[];
            firstSeenRunCode?: string | null;
            verifications: components["schemas"]["Verification"][];
            /** @description 마지막으로 실패한 시도의 단계. 통과했으면 마지막 시도의 단계 */
            reproductionSteps: components["schemas"]["RunStep"][];
            /** @description AI 분석 결과(rank 순). analysisStatus가 COMPLETED가 아니면 빈 배열 */
            rootCauses: components["schemas"]["RootCauseCandidate"][];
            artifacts: components["schemas"]["ArtifactRef"][];
        };
        GeneratedSpec: {
            testCaseCode: string;
            /** @example tc-12.spec.ts */
            fileName: string;
            source: string;
            rendererVersion: string;
            compileStatus: components["schemas"]["CompileStatus"];
            compileError?: string | null;
        };
    };
    responses: {
        /** @description 입력값 오류 (VALIDATION_FAILED) */
        BadRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description 대상 없음 (RESOURCE_NOT_FOUND) */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description 현재 상태에서 불가능한 요청 */
        Conflict: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description 파일 크기 초과 (FILE_TOO_LARGE) */
        PayloadTooLarge: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description 내부 서비스(AI 서버, 실행기)에 연결할 수 없음 (DEPENDENCY_UNAVAILABLE) */
        ServiceUnavailable: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
    };
    parameters: {
        ProjectId: string;
        TestRequestId: string;
        ScenarioId: string;
        RunId: string;
        CaseResultId: string;
        Cursor: string;
        Limit: number;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getCurrentUser: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 현재 사용자 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["User"];
                };
            };
        };
    };
    listProjects: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 프로젝트 목록 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["Project"][];
                    };
                };
            };
        };
    };
    createProject: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectCreate"];
            };
        };
        responses: {
            /** @description 생성됨 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Project"];
                };
            };
            400: components["responses"]["BadRequest"];
        };
    };
    getProject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 프로젝트 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Project"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    updateProject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProjectUpdate"];
            };
        };
        responses: {
            /** @description 수정됨 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Project"];
                };
            };
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
        };
    };
    verifyTargetSite: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 확인 결과. 대상 사이트 접속 실패도 200으로 반환하고 status로 구분한다. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TargetVerification"];
                };
            };
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            /** @description 실행기에 연결할 수 없어 확인하지 못함 (DEPENDENCY_UNAVAILABLE). 대상 사이트 실패와 구분하며 프로젝트 상태는 바꾸지 않는다. */
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listDocuments: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 문서 목록 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["Document"][];
                    };
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    uploadDocument: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    type: components["schemas"]["DocumentType"];
                    /** Format: binary */
                    file: Blob;
                };
            };
        };
        responses: {
            /** @description 업로드됨 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Document"];
                };
            };
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            413: components["responses"]["PayloadTooLarge"];
        };
    };
    getDocument: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                documentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 문서 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Document"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    deleteDocument: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                documentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 삭제됨 */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    getDocumentDownloadLink: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                documentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 다운로드 링크 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DownloadLink"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    downloadDocumentTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                documentType: components["schemas"]["DocumentType"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 템플릿 파일 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": Blob;
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    getKnowledgeBase: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 지식 베이스 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeBase"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    buildKnowledgeBase: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 구축 시작 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KnowledgeBase"];
                };
            };
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    listActivities: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 활동 목록 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["Activity"][];
                    };
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    listTestRequests: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 요청 목록 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["TestRequest"][];
                        nextCursor?: string | null;
                    };
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    createTestRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TestRequestCreate"];
            };
        };
        responses: {
            /** @description 후보 생성 시작 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TestRequest"];
                };
            };
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    getTestRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                testRequestId: components["parameters"]["TestRequestId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 요청 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TestRequest"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    selectRefinedRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                testRequestId: components["parameters"]["TestRequestId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SelectionRequest"];
            };
        };
        responses: {
            /** @description 시나리오 생성 시작 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TestRequest"];
                };
            };
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    listScenarios: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                testRequestId: components["parameters"]["TestRequestId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 시나리오 목록과 상태 집계 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScenarioList"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    getScenario: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scenarioId: components["parameters"]["ScenarioId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 시나리오 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Scenario"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    updateScenario: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scenarioId: components["parameters"]["ScenarioId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ScenarioUpdate"];
            };
        };
        responses: {
            /** @description 수정됨 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Scenario"];
                };
            };
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    approveScenario: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scenarioId: components["parameters"]["ScenarioId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 승인됨 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Scenario"];
                };
            };
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    rejectScenario: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scenarioId: components["parameters"]["ScenarioId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 반려됨 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Scenario"];
                };
            };
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    regenerateScenario: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scenarioId: components["parameters"]["ScenarioId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    feedback?: string;
                };
            };
        };
        responses: {
            /** @description 재생성 시작 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Scenario"];
                };
            };
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    getTestCase: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                testCaseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 테스트 케이스 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TestCase"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    updateTestCase: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                testCaseId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TestCaseUpdate"];
            };
        };
        responses: {
            /** @description 수정됨 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TestCase"];
                };
            };
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    startRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                testRequestId: components["parameters"]["TestRequestId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RunCreate"];
            };
        };
        responses: {
            /** @description 실행 준비 시작 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    listRuns: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                projectId: components["parameters"]["ProjectId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 실행 목록 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["Run"][];
                        nextCursor?: string | null;
                    };
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    getRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 실행 상세 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunDetail"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    cancelRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 중단 요청됨 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    rerunRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["RerunRequest"];
            };
        };
        responses: {
            /** @description 새 실행 시작 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Run"];
                };
            };
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    streamRunEvents: {
        parameters: {
            query?: {
                /** @description 첫 연결에 사용한다. 브라우저 EventSource는 첫 요청에 헤더를 지정할 수 없기 때문이다. 스냅샷의 lastEventSeq를 넣는다. */
                afterSeq?: number;
            };
            header?: {
                /** @description 재연결 시 브라우저가 자동으로 보낸다. afterSeq와 함께 오면 이 값을 우선한다. */
                "Last-Event-ID"?: string;
            };
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Server-Sent Events 스트림 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    listRunLogs: {
        parameters: {
            query?: {
                afterSeq?: number;
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 로그 목록 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["RunLogEntry"][];
                        /** Format: int64 */
                        nextAfterSeq?: number | null;
                    };
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    listRunApiCalls: {
        parameters: {
            query?: {
                cursor?: components["parameters"]["Cursor"];
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description API 호출 목록 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["ApiCall"][];
                        totalCount: number;
                        averageDurationMs?: number | null;
                        nextCursor?: string | null;
                    };
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    getRunReport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 리포트 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunReport"];
                };
            };
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    exportRunReportPdf: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                runId: components["parameters"]["RunId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description PDF 파일 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/pdf": Blob;
                };
            };
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
        };
    };
    getCaseResult: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                caseResultId: components["parameters"]["CaseResultId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 케이스 결과 상세 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseResultDetail"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    getCaseResultSpec: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                caseResultId: components["parameters"]["CaseResultId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description spec 코드 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GeneratedSpec"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    getArtifactDownloadLink: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                artifactId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 다운로드 링크 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DownloadLink"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
}
