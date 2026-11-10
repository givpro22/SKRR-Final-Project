# 상태 전이 계약

백엔드가 유일하게 상태를 바꾼다. 아래에 없는 전이는 `409 INVALID_STATE_TRANSITION`으로 거부한다. 화면 문구는 UI 캡처에 나온 표현을 쓴다.

## Document (UI-01)

```text
UPLOADED → INDEXING → INDEXED
              ↑     ↘ FAILED
              │     ↘ SKIPPED
              └── INDEXED | FAILED | SKIPPED   (재구축)
UPLOADED → REGISTERED                          (TEST_DATA는 인덱싱하지 않음)
```

| 값 | 화면 표시 | 뜻 |
|---|---|---|
| `UPLOADED` | 구축 대기 | 필수 문서를 올렸고 아직 구축하지 않음 |
| `INDEXING` | 인덱싱 중 N% | 구축 작업이 처리 중. N은 `indexProgress` |
| `INDEXED` | 인덱싱 완료 | 지식 베이스에 들어감 |
| `FAILED` | 인덱싱 실패 | 이 문서 때문에 구축이 실패함. `errorMessage`에 사유 |
| `SKIPPED` | 건너뜀 | 다른 문서의 오류로 이번 구축에서 처리하지 않음. `errorMessage`에 사유 |
| `REGISTERED` | 등록됨 | TEST_DATA. 형식 검사만 하고 AI 서버로 보내지 않음 |

문서 없음은 "파일 선택" 버튼과 오류 강조로 표시한다.

규칙 (ADR-018, ADR-020):

- **인덱싱은 구축 때 시작한다.** 업로드만으로는 `UPLOADED`("구축 대기")에 머문다. "지식 베이스 구축"(`buildKnowledgeBase`)을 누르면 활성 필수 문서 3종이 모두 `INDEXING`이 된다. UI-01 캡처의 "업로드 직후 인덱싱 중 68%"와 다르다 (ADR-012 충돌표).
- **재구축은 전체를 다시 인덱싱한다.** `STALE`·`FAILED` 지식 베이스를 다시 구축하면 이미 `INDEXED`인 문서도 `INDEXING`으로 돌아간다. AI 서버가 인덱스 파일을 통째로 다시 만들기 때문이다.
- **구축 결과는 문서별로 나눈다.** 성공하면 모두 `INDEXED`. 실패하면 원인이 된 문서는 `FAILED`, 나머지는 `SKIPPED`이다. 인덱스 저장 실패나 AI 서버 장애처럼 특정 문서가 원인이 아닌 실패는 처리 중이던 문서를 모두 `FAILED`로 두고 같은 사유를 적는다.
- `FAILED`·`SKIPPED` 문서는 재구축(`→ INDEXING`)으로 다시 시도한다. 원인 문서는 보통 새 버전을 올린 뒤 재구축한다.
- 새 버전을 올리면 새 문서 행이 `UPLOADED`로 생기고 이전 행은 비활성(`isActive=false`)이 된다. 비활성 문서의 상태는 더 바꾸지 않는다.

## KnowledgeBase (UI-01)

```text
NOT_BUILT → BUILDING → READY → STALE → BUILDING
                     ↘ FAILED → BUILDING
```

| 값 | 화면 표시 |
|---|---|
| `NOT_BUILT` | 미구축 |
| `BUILDING` | 구축 중 |
| `READY` | 최신 |
| `STALE` | 재구축 필요 |
| `FAILED` | 구축 실패 |

활성 필수 문서(REQUIREMENT, API_SPEC, CATALOG)가 바뀌면(업로드, 교체, 삭제) `READY → STALE`이다. 구축 중에 바뀌면 구축이 끝난 뒤 `READY → STALE`로 한 번 더 옮긴다. TEST_DATA의 업로드·교체·삭제는 지식 베이스 상태를 바꾸지 않는다. AI 서버로 보내지 않아 인덱스가 낡지 않기 때문이다 (ADR-020).

`STALE`에서는 새 테스트 요청을 받지 않는다. 낡은 근거로 시나리오를 만들지 않기 위해서다.

## 등록 요건 판정 (UI-01 "등록 요건")

`getKnowledgeBase.readiness`의 4개 항목이다. 문서 내용은 인덱싱한 뒤에야 알 수 있으므로 내용 관련 항목은 인덱싱 결과로 판정한다. 화면 문구(`label`)는 UI-01 캡처를 따른다.

| key | 충족 조건 |
|---|---|
| `TARGET_REACHABLE` | 프로젝트 `targetUrlStatus = REACHABLE` |
| `REQUIREMENT_ID_FORMAT` | 활성 REQUIREMENT 문서가 `INDEXED`이고 `summary.requirementCount > 0` (또는 지식 베이스 `requirementCount > 0`) |
| `READ_ONLY_QUERY_API` | 활성 API_SPEC 문서가 있고 프로젝트 `queryApiBaseUrl`이 있음 |
| `CATALOG_TESTID_MAPPED` | 활성 CATALOG 문서가 `INDEXED`이고 `summary.elementCount > 0` (또는 지식 베이스 `uiElementCount > 0`) |

등록 요건은 안내용이다. `canBuild`는 필수 문서 3종이 모두 있고 지식 베이스가 `BUILDING`으로 옮길 수 있는 상태(`NOT_BUILT`, `STALE`, `FAILED`)일 때 참이며, 등록 요건과는 무관하다.

## TestRequest (UI-02-1, UI-02-1B)

```text
REFINING → AWAITING_SELECTION → GENERATING → GENERATED
       ↘ FAILED              ↘ FAILED
```

`FAILED`에서 다시 시도하려면 새 요청을 만든다.

## Scenario (UI-02-5)

```text
GENERATING → REVIEW_REQUIRED → APPROVED
    │              │              │ (내용 수정, 재생성)
    │              │              └→ REVIEW_REQUIRED / GENERATING
    │              └→ REJECTED → GENERATING (재생성)
    └→ GUARD_RETRY ⇄ GENERATING   (가드 실패, 최대 3회)
             └→ GUARD_FAILED → GENERATING (재생성)
```

| 값 | 화면 표시 |
|---|---|
| `GENERATING` | 생성 중 |
| `GUARD_RETRY` | 가드 재생성 + `가드 실패: {사유} (N/3회)` |
| `REVIEW_REQUIRED` | 검토 필요 |
| `APPROVED` | 승인 |
| `REJECTED` | 반려 |
| `GUARD_FAILED` | 3회 실패. 카탈로그 수정 필요 여부를 함께 표시 |

실행에는 `APPROVED`만 넣을 수 있다. 승인된 뒤 시나리오나 소속 케이스 내용이 바뀌면 승인을 해제한다. 검토하지 않은 내용이 실행되는 일을 막기 위해서다 (FR-03).

## Run (UI-03, UI-04)

```text
PREPARING → RUNNING → PASSED
    │          ├────→ FAILED
    │          ├────→ ERROR
    │          └────→ CANCELLING → CANCELLED
    ├─────────────→ CANCELLING
    └─────────────→ ERROR
```

- `FAILED`: 테스트가 끝까지 돌았고 실패 케이스가 있음.
- `ERROR`: 실행 자체가 실패함 (실행기 불능, TestQuery 생성 실패 등). 품질 결함이 아니라 환경 문제이므로 구분한다.
- 프로젝트당 진행 중인 실행은 1개다. 이미 있으면 `409 RUN_ALREADY_ACTIVE`를 반환한다.
- 케이스 하나의 TestQuery 생성이나 변환이 3회 실패하면 그 케이스만 `ERROR`(`TEST_CODE_ERROR`)로 두고 나머지는 계속 실행한다.
- 실행기나 대상 사이트에 아예 접속할 수 없으면 남은 케이스를 멈추고 실행을 `ERROR`로 끝낸다.

실행 끝 상태는 다음 순서로 정한다.

| 순서 | 조건 | 끝 상태 |
|---|---|---|
| 1 | 사용자가 중단함 | `CANCELLED` |
| 2 | 실행 자체가 불가능해 멈춤 | `ERROR` |
| 3 | `FAILED` 케이스가 하나라도 있음 | `FAILED` |
| 4 | `ERROR` 케이스가 하나라도 있음 | `ERROR` |
| 5 | 그 밖의 경우 | `PASSED` |

`ERROR` 케이스는 결함 탐지율과 오탐률 계산에서 빼고 따로 센다. 환경 문제를 제품 결함이나 오탐으로 세지 않기 위해서다.

## ScenarioRun, CaseResult

```text
ScenarioRun: WAITING → RUNNING → PASSED | FAILED | ERROR | CANCELLED
             WAITING → SKIPPED | CANCELLED
CaseResult:  PENDING → RUNNING → PASSED | FAILED | ERROR | CANCELLED
             PENDING → SKIPPED | CANCELLED
```

시나리오 끝 상태는 실행 끝 상태와 같은 규칙(3~5번)을 소속 케이스에 적용해 정한다.

케이스가 실패하면 최대 3회까지 실행해 재현 횟수를 기록한다 (UI-04 "3회 중 3회"). 3회 중 1회라도 통과하면 `PASSED`가 아니라 `FAILED`로 두고 재현 횟수로 불안정함을 드러낸다. 성공 기준의 오탐률 산정을 흐리지 않기 위해서다.

## 케이스 실행 순서 (WBS 4.3.9)

```text
데이터 초기화(SETUP) → DB 사전 조회(BEFORE) → 실행기 실행(UI/API)
  → DB 사후 조회(AFTER) → 교차 검증(ASSERT) → 데이터 정리(TEARDOWN)
```

중간 단계가 실패해도 정리 단계는 수행한다. 다음 케이스의 사전조건이 오염되지 않게 하기 위해서다.

## API 검사와 교차 검증 판정

API 단계는 다음 순서로 검사한다. 앞 단계가 실패하면 뒤 단계는 하지 않는다.

| 순서 | 검사 | 실패 시 `failureType` |
|---|---|---|
| 1 | `expectStatus` 상태 코드 | `API_ERROR` |
| 2 | `responseSchema` 응답 구조 | `API_SCHEMA_MISMATCH` |
| 3 | `expectCapture` 기대값 | `ASSERTION_FAILED` |
| 4 | `crossChecks` 화면·API·DB 비교 | `DATA_MISMATCH` |

`schemaCheck`는 `PASSED`, `FAILED`, `NOT_CHECKED` 중 하나다. 명세에 응답 구조가 없으면 `NOT_CHECKED`이며, 통과로 세지 않는다.

`crossChecks` 판정은 정규화한 값으로 다음과 같이 정한다.

| 조건 | 판정 |
|---|---|
| 지정한 출처의 값을 얻지 못함 | `MISMATCH` |
| 값들이 서로 다름 | `MISMATCH` |
| 값들이 같지만 `expected`와 다름 | `MISMATCH` |
| 값들이 같고 `expected`와 같음 | `MATCH` |
| `consistencyOnly`이고 값들이 서로 같음 | `MATCH` |
| 비교할 출처가 없음 | `NOT_APPLICABLE` |
