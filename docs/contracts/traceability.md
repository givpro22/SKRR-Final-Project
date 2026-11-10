# 요구사항 추적표

요구사항서의 수용기준에서 화면, API, 테이블, WBS 작업까지 잇는다. 표의 API 이름은 `check_contracts.py`가 실제 OpenAPI와 대조하므로, API를 추가하면 여기에도 적는다.

## 플랫폼 요구사항

| ID | 우선순위 | 수용기준 (요구사항서) | 화면 | 플랫폼 API | 내부 API | 테이블 | WBS |
|---|---|---|---|---|---|---|---|
| FR-01 | Must | 필수 항목이 빠지면 등록을 거부하고 빠진 항목을 알려 준다 | UI-01 | `verifyTargetSite` `uploadDocument` `listDocuments` `getKnowledgeBase` `buildKnowledgeBase` | `startKnowledgeBaseBuild` `checkTargetConnectivity` | project, document, knowledge_base | 4.3.2, 4.5.1, 4.5.2 |
| FR-02 | Must | 기능 이름으로 명세를 검색하면 해당 명세가 상위 3개 안에 90% 이상 포함된다 | UI-02-1, UI-02-1B | `createTestRequest` `getTestRequest` `selectRefinedRequest` | `startRequestRefinement` | test_request, request_candidate | 4.5.3 |
| FR-03 | Should | 모호한 요청 10건 중 8건 이상에서 적절한 명세 기반 요청이 나온다 | UI-02-1B, UI-02-5 | `listScenarios` `updateScenario` `updateTestCase` `approveScenario` `rejectScenario` `regenerateScenario` | `startScenarioGeneration` | scenario, test_case | 4.5.3~4.5.6 |
| FR-04 | Must | 승인된 시나리오가 100% 실행 가능한 코드로 바뀌고 문법 검사를 통과한다 | UI-02-5, UI-03 | `startRun` `getCaseResultSpec` | `startTestQueryGeneration` `renderSpec` | generated_spec | 4.6, 4.6.1 |
| FR-05 | Must | API 호출과 로그가 실시간으로 화면에 나타난다 | UI-03 | `getRun` `streamRunEvents` `listRunLogs` `listRunApiCalls` `cancelRun` | `startExecution` `getExecution` `streamExecutionEvents` `cancelExecution` | test_run, scenario_run, case_result, run_step, api_call, run_event | 4.3.6, 4.3.9, 4.6.2 |
| FR-06 | Should | 성공·실패 여부와 실패 원인을 정상적으로 분석한다 | UI-04 | `getCaseResult` | `startFailureAnalysis` | verification, root_cause_candidate | 4.3.7, 4.3.10, 4.7 |
| FR-07 | Should | 실행 로그와 API 호출 결과로 리포트를 생성한다 | UI-04 | `getRunReport` `rerunRun` `getArtifactDownloadLink` | | case_result, artifact | 4.6.4, 4.7.1, 4.7.2 |
| NFR-01 | Should | 생성 코드가 대상 환경에서 오류 없이 안정적으로 실행된다 | UI-03 | | `runnerReady` | generated_spec, case_result | 4.2.4, 4.3.8, 4.6.3 |

## 성공 기준 (요구사항서 1-8)

| 기준 | 측정 방법 | 담당 |
|---|---|---|
| 자연어 요청 한 줄로 리포트까지 완주 (10건 중 8건 이상) | 평가 요청 10건을 전체 흐름으로 실행 | QA + AI |
| 심어 둔 장애의 80% 이상 탐지, 정상 시스템 오탐 5% 이하 | `POST {testControlUrl}/faults`로 장애 주입 후 실행 | QA + AI |
| 탐지한 장애의 70% 이상에서 실제 원인을 1순위로 제시 | 장애 목록의 정답 원인과 `rank=1` 비교 | AI |

## 요구사항 번호가 없는 지원 API

화면 구성이나 운영에 필요하지만 요구사항서에 별도 번호가 없는 API다.

| 분류 | operationId |
|---|---|
| 사용자·프로젝트 | `getCurrentUser` `listProjects` `createProject` `getProject` `updateProject` `listActivities` |
| 문서 부가 기능 | `getDocument` `deleteDocument` `getDocumentDownloadLink` `downloadDocumentTemplate` |
| 조회 | `listTestRequests` `getScenario` `getTestCase` `listRuns` |
| MVP 이후 | `exportRunReportPdf` |
| 내부 운영 | `aiHealth` `aiReady` `getAiJob` `cancelAiJob` `runnerHealth` |

## UI에만 있고 WBS에 작업이 없는 항목

| 항목 | 처리 |
|---|---|
| 리포트 PDF 내보내기 | MVP 이후 (ADR-013). API에 `x-priority: later`로 표시하고 구현하지 않음 |
| 이전 실행 대비 비교 | MVP 포함 (ADR-013). `RunComparison`으로 구현. WBS 4.7에 작업 추가 필요 |
| 플랫폼 배포와 쿠버네티스 | ADR-008로 결정. WBS에 작업 추가 필요 |

## 화면 캡처와 다르게 정한 항목

| 화면 | 캡처 | 계약 | 근거 |
|---|---|---|---|
| UI-01 | 업로드 직후 문서별 "인덱싱 중 68%" | 업로드 후 "구축 대기", "지식 베이스 구축"을 눌러야 인덱싱 | ADR-018 |
| UI-01 | 배지 "Playwright 연결 확인" | 배지 "연결 확인". HTTP GET 판정, 4xx 응답도 도달 가능 | ADR-019 |
| UI-01 | 문서 상태 4가지(완료, 인덱싱 중, 미등록, 등록됨) | "구축 대기", "인덱싱 실패", "건너뜀"을 더함 | ADR-018, ADR-020 |
