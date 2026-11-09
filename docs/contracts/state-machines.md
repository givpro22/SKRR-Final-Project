# 상태 전이 계약

백엔드가 유일하게 상태를 바꾼다. 아래에 없는 전이는 `409 INVALID_STATE_TRANSITION`으로 거부한다. 화면 문구는 UI 캡처에 나온 표현을 쓴다.

## Document (UI-01)

```text
UPLOADED → INDEXING → INDEXED
                    ↘ FAILED → INDEXING (재시도)
UPLOADED → REGISTERED            (TEST_DATA는 인덱싱하지 않음)
```

표시: `INDEXED` 인덱싱 완료, `INDEXING` 인덱싱 중 N%, `REGISTERED` 등록됨, `FAILED` 인덱싱 실패, 문서 없음은 "파일 선택" 버튼과 오류 강조.

## KnowledgeBase (UI-01)

```text
NOT_BUILT → BUILDING → READY → STALE → BUILDING
                     ↘ FAILED → BUILDING
```

활성 문서가 바뀌면 `READY → STALE`이다. `STALE`에서는 새 테스트 요청을 받지 않는다. 낡은 근거로 시나리오를 만들지 않기 위해서다.

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

## ScenarioRun, CaseResult

```text
ScenarioRun: WAITING → RUNNING → PASSED | FAILED | CANCELLED
             WAITING → SKIPPED | CANCELLED
CaseResult:  PENDING → RUNNING → PASSED | FAILED | ERROR | CANCELLED
             PENDING → SKIPPED | CANCELLED
```

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
