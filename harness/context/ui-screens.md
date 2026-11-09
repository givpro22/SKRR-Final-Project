# UI 화면 명세

`harness/references/export/`의 캡처를 텍스트로 정리했다. **화면을 구현하거나 검증할 때는 이 요약만 믿지 말고 해당 PNG를 직접 연다.** 치수는 캡처에서 추정한 값이다.

## 파일과 경로

| 화면 ID | 파일 (`export/`) | 경로 | 사이드바 |
|---|---|---|---|
| UI-01 | `UI-01 문서 등록.png` | `/projects/:projectId/documents` | 문서 · 지식 |
| UI-02-1 | `UI-02-1 테스트 시나리오 입력 (모달).png` | UI-02-5 위 모달 | 시나리오 승인 |
| UI-02-1B | `UI-02-1B 테스트 시나리오 선택 (모달).png` | UI-02-5 위 모달 | 시나리오 승인 |
| 완료 모달 | `UI-02-1B 테스트 시나리오 선택 (모달)-1.png` | UI-02-5 위 모달 | 시나리오 승인 |
| UI-02-5 | `UI-02-5 시나리오 · 테스트 케이스 조회.png` | `/projects/:projectId/requests/:requestId/scenarios` | 시나리오 승인 |
| UI-03 | `UI-03 실행 모니터.png` | `/projects/:projectId/runs/:runId/monitor` | 실행 모니터 |
| UI-04 | `UI-04 결과 리포트.png` | `/projects/:projectId/runs/:runId/report` | 리포트 |

사이드바의 "테스트 요청" 화면은 캡처가 없다. `/projects/:projectId/requests`에 요청 목록과 입력 모달 진입 버튼을 다른 화면과 같은 스타일로 최소 구현하고, 디자인 확인이 필요하다고 보고한다.

## 디자인 토큰

색상은 캡처에서 픽셀로 추출했다 (2026-11-09). Tailwind 테마 변수로 등록하며, 이름에서 `--color-`를 뺀 부분이 유틸리티 이름이 된다 (`--color-page` → `bg-page`, `text-page`).

| 테마 변수 | 값 | 용도 |
|---|---|---|
| `--color-page` | `#F6F6F3` | 페이지 배경, 사이드바 지식 베이스 카드 |
| `--color-surface` | `#FFFFFF` | 카드, 사이드바, 모달 |
| `--color-line` | `#F1F1EF` | 약한 카드 경계. 입력창과 보조 버튼 경계는 캡처에서 더 진함 |
| `--color-ink` | `#14161B` | 제목, 주 버튼 배경 |
| `--color-muted` | `#7E838C` | 대기 상태, 보조 정보 |
| `--color-accent` | `#2F4BFF` | 실행 중, 선택 라디오, 요구사항 ID 링크 |
| `--color-accent-soft` | `#ECEFFF` | 사이드바 활성 항목, 선택 행, 경계 배지 |
| `--color-accent-row` | `#F7F8FF` | 실행 중 시나리오 행 |
| `--color-focus` | `#97A5FF` | 입력창 포커스 부근 |
| `--color-success` / `--color-success-soft` | `#0E7A50` / `#E4F4EC` | 통과, 승인, 인덱싱 완료, 정상 배지 |
| `--color-danger` / `--color-danger-soft` | `#B42318` / `#FCEAE7` | 실패, 불일치, 오류 배너, 가드 재생성 |
| `--color-danger-row` | `#FFFBFA` | 필수 문서 누락 행 |
| `--color-warning-soft` | `#FBF0D9` | 검토 필요 배지, 예외 배지 |
| `--color-log` | `#111318` | 실시간 로그 패널 |
| `--color-overlay` | 약 `rgb(20 22 27 / 0.6)` | 모달 뒤 배경 |

경고 글자색은 캡처에서 확인해 맞춘다. 글꼴은 Pretendard 계열 본문과 모노스페이스(ID, URL, 경로, 로그, 숫자)로 보인다. 아이콘은 선 형태다.

## 공통 레이아웃 (기준 폭 1440px)

- 좌측 사이드바 약 248px: 로고 `SKRR` / `AI QA Studio`, 프로젝트 선택, 메뉴 5개(문서 · 지식, 테스트 요청, 시나리오 승인, 실행 모니터, 리포트), 하단에 RAG 지식 베이스 카드(청크 수, 동기화 시각)와 사용자(이름, 역할)
- 본문: 좌우 여백 약 40px. 상단에 브레드크럼(`목업 쇼핑몰 v1.2 / 테스트 요청 / REQ-0142`), 큰 제목, 우측 액션 버튼
- 카드: 흰 배경, 둥근 모서리 약 16px. 배지는 알약 형태에 아이콘 포함

## UI-01 문서 등록

| 영역 | 내용 |
|---|---|
| 헤더 | 제목 "테스트 기준 문서 등록". 버튼 `템플릿 받기`, `지식 베이스 구축`(필수 문서 전까지 비활성) |
| 오류 배너 | "필수 문서 1개가 빠져 등록할 수 없습니다" + 빠진 문서 안내. FR-01 수용기준 |
| 대상 사이트 URL | 입력창과 `Playwright 연결 확인` 배지 |
| 기준 문서 | 요구사항 명세서(필수), API 명세서(필수), 카탈로그(필수), 테스트 데이터(선택). 파일명, 크기, 요약 수치, 더보기 메뉴. 집계 "필수 3개 중 2개 등록 · 선택 1개" |
| 문서 상태 | 인덱싱 완료(초록), 인덱싱 중 68%(파랑), 미등록은 빨간 설명과 `파일 선택`, 등록됨(초록) |
| 업로드 영역 | 드래그 앤 드롭, "PDF · DOCX · YAML · JSON · CSV, 파일당 20MB 이하 · AWS S3에 저장" |
| 우측 | 등록 요건 체크리스트 4개, 지식 베이스 미리보기(요구사항, API, 화면 요소 수), 최근 활동(시각 + 문구) |

사용 API: `getProject` `updateProject` `verifyTargetSite` `listDocuments` `uploadDocument` `deleteDocument` `getDocumentDownloadLink` `downloadDocumentTemplate` `getKnowledgeBase` `buildKnowledgeBase` `listActivities`

## UI-02-1 시나리오 입력 모달

제목 "테스트 시나리오 입력", 안내 "평소 말하듯 적어 주세요. AI가 등록된 명세를 찾아 선택지로 정리합니다." 입력창과 글자 수 `38 / 500자`, 버튼 `취소`, `생성하기`.

사용 API: `createTestRequest`, 이후 `getTestRequest` 2초 간격 조회

## UI-02-1B 시나리오 선택 모달

제목 "테스트 시나리오 선택", 안내 "입력한 요청과 비슷한 시나리오 중 테스트할 내용을 하나 골라 주세요." 입력한 요청 상자, 후보 라디오 4개, `기타 직접 입력`, 버튼 `이전`, `테스트 케이스 생성하기`.

사용 API: `selectRefinedRequest`

## 생성 완료 모달

체크 아이콘, "테스트 케이스 생성이 완료되었습니다", `확인`. 문구는 ADR-012에 따라 "시나리오 N개, 테스트 케이스 M개를 만들었어요"로 쓴다. N, M은 `scenarioCount`, `testCaseCount`다.

## UI-02-5 시나리오·케이스 조회

| 영역 | 내용 |
|---|---|
| 헤더 | "테스트 시나리오 · 케이스 조회". 버튼 `테스트 시나리오 생성`, `테스트 실행` |
| 요약 | "생성된 시나리오 6", 범례 승인 4 · 검토 필요 1 · 가드 재생성 1 |
| 시나리오 행 | 체크박스, 펼침, `SC-01`, 제목, 케이스 수, UI/API/DB 칩, 요구사항 ID 링크, 상태 배지, 수정 아이콘 |
| 펼친 케이스 표 | ID, 테스트 케이스, 유형(정상·예외·경계), 검증 범위, 예상 결과, 상세 화살표 |
| 가드 실패 | 행 아래 빨간 글자: "가드 실패: 카탈로그에 'cart-remove-button' 요소가 없어 재생성 중 (2/3회)" |

승인된 시나리오만 체크할 수 있다. 캡처에서도 검토 필요와 재생성 행은 체크되지 않았다.

사용 API: `listScenarios` `updateScenario` `updateTestCase` `approveScenario` `rejectScenario` `regenerateScenario` `getTestCase` `startRun`

## UI-03 실행 모니터

| 영역 | 내용 |
|---|---|
| 헤더 | "테스트 실행 중", `LIVE · 02:14` 배지. 버튼 `spec 코드 보기`, `실행 중단`(빨간 테두리) |
| 진행 | `2 / 4 시나리오 완료`, 4색 막대, 범례 통과·실패·실행 중·대기 |
| 시나리오 카드 | 상태 아이콘, 제목, 코드, 상태, 시간. 실행 중인 카드는 단계 목록을 펼쳐 완료·진행·대기를 표시 (`3/6 단계`) |
| 현재 화면 | 브라우저 스크린샷, 우측 상단에 경로 `/checkout` |
| API 호출 | `12건 · 평균 214ms`, 메서드, 경로, 상태 코드, 시간 |
| 실시간 로그 | 어두운 패널, 탭(실시간 로그, `sc-03.spec.ts`, Trace), `streaming` 표시. 시각, 라벨(API, UI, ASSERT, DB), 메시지 |

캡처 속 사이트명·금액과 로그 금액이 다른 것은 예시 데이터 차이이므로 재현하지 않는다.

사용 API: `getRun` `streamRunEvents` `listRunLogs` `listRunApiCalls` `cancelRun` `getCaseResultSpec` `getArtifactDownloadLink`. 이벤트는 `docs/contracts/events.md`

## UI-04 결과 리포트

| 영역 | 내용 |
|---|---|
| 헤더 | "테스트 결과 리포트". 브레드크럼에 `RUN-0318 · 2026.11.06 10:53`. 버튼 `실패 2건 재실행`. 캡처의 `PDF 내보내기`는 MVP에서 표시하지 않음 (ADR-013) |
| 메타 | 대상과 빌드, 환경(Chromium 130 · 1280×800), 실행자와 시간, 기준 문서 버전 |
| 지표 5개 | 시나리오 통과 `2 / 4`, 케이스 통과 `16 / 18`(89%), 실패 케이스, 교차 검증 불일치, 총 소요 |
| 좌측 | 탭(전체, 실패, 통과). 시나리오별 결과, 실패 케이스 우선 표시, "통과한 케이스 N개 보기" 접기. 미실행 안내. 이전 실행 대비(새로운 실패, 계속 실패, 해결됨, 통과율) |
| 우측 상세 | 실패 탐색 `1 / 2`, `이 케이스 재실행`. 심각도, 실패 유형, 재현 횟수, 영향 기능, 처음 발생 |
| 교차 검증 표 | 검증 항목, UI, API, DB, 판정. 불일치 값에 경고 아이콘. 세 값이 같은데 기대값과 달라 불일치면 행에 `expectedValue`를 함께 표시 (캡처에 없는 경우이므로 같은 스타일로 추가) |
| 재현 단계 | 번호, 설명, 우측에 근거 값. 실패 단계는 빨간 배경에 "예상 qty 3 · 실제 qty 2". API 단계의 `schemaCheck`가 `FAILED`면 `detail`을 표시 |
| 원인 후보 | 순위, 설명, 확률 막대. 1순위 카드는 근거와 해결 방안(초록) 포함 |
| 실행 증거 | 실패 스크린샷, Playwright trace, HAR, `tc-12.spec.ts` |

사용 API: `getRunReport` `getCaseResult` `rerunRun` `getCaseResultSpec` `getArtifactDownloadLink`

## 상태 문구

| 계약 값 | 화면 표시 |
|---|---|
| `NORMAL` / `EXCEPTION` / `BOUNDARY` | 정상 / 예외 / 경계 |
| `APPROVED` / `REVIEW_REQUIRED` / `GUARD_RETRY` / `GENERATING` / `REJECTED` / `GUARD_FAILED` | 승인 / 검토 필요 / 가드 재생성 / 생성 중 / 반려 / 가드 실패 |
| `PASSED` / `FAILED` / `RUNNING` / `WAITING` / `SKIPPED` / `CANCELLED` | 통과 / 실패 / 실행 중 / 대기 / 건너뜀 / 중단됨 |
| `MATCH` / `MISMATCH` / `NOT_APPLICABLE` | 일치 / 불일치 / 해당 없음 |
| `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` | 치명 / 높음 / 중간 / 낮음 |
| `DATA_MISMATCH` / `API_SCHEMA_MISMATCH` | 데이터 불일치 / 응답 구조 불일치 |
| `schemaCheck`: `PASSED` / `FAILED` / `NOT_CHECKED` | 구조 일치 / 구조 불일치 / 구조 미검사 |
