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

| 값 | 화면 | 백엔드 동작 |
|---|---|---|
| `REFINING` | UI-02-1 "생성하기" 뒤 대기 | AI `startRequestRefinement` 작업 조회 |
| `AWAITING_SELECTION` | UI-02-1B 후보 선택 | 후보 저장 완료. `selectRefinedRequest`만 받는다 |
| `GENERATING` | 후보 선택 뒤 대기 | AI `startScenarioGeneration` 작업 조회 |
| `GENERATED` | 생성 완료 모달 → UI-02-5 | 시나리오·케이스 저장 완료, `scenarioCount`·`testCaseCount` 채움 |
| `FAILED` | 오류 문구(`errorMessage`) | AI 작업 실패. 지식 베이스 문제(`KNOWLEDGE_BASE_MISSING`, `EMBEDDING_MODEL_MISMATCH`)면 재구축 안내 |

- 시나리오 행은 생성 작업이 **끝날 때 한꺼번에** 만든다. 생성 중에는 UI-02-5 목록이 비어 있고 대기 화면을 보여 준다. 처리 중인 시나리오와 가드 재시도는 AI 작업 `progress`(`scenarioCode`, `attempt`, `message`)로 알 수 있다.
- UI-02-1B의 "이전"은 화면만 UI-02-1로 돌린다. 이전 요청은 `AWAITING_SELECTION`으로 남고, 다시 "생성하기"를 누르면 새 요청이 생긴다.

## Scenario (UI-02-5)

```text
GENERATING → REVIEW_REQUIRED → APPROVED
    │              │              │ (내용 수정, 재생성)
    │              │              └→ REVIEW_REQUIRED / GENERATING
    │              ├→ GENERATING (재생성)
    │              └→ REJECTED → GENERATING (재생성)
    └→ GUARD_RETRY ⇄ GENERATING   (가드 실패, 최대 3회)
             └→ GUARD_FAILED → GENERATING (재생성)
```

| 동작 | 받는 상태 | 결과 |
|---|---|---|
| `approveScenario` | `REVIEW_REQUIRED` | `APPROVED` |
| `rejectScenario` | `REVIEW_REQUIRED` | `REJECTED` |
| `updateScenario`, `updateTestCase` | `REVIEW_REQUIRED`, `APPROVED`, `REJECTED`, `GUARD_FAILED` | 내용이 바뀌면 `REVIEW_REQUIRED`, version 증가 |
| `regenerateScenario` | `REVIEW_REQUIRED`, `APPROVED`, `REJECTED`, `GUARD_FAILED` | `GENERATING` |

그 밖의 조합은 `409 INVALID_STATE_TRANSITION`이다.

- 첫 생성(요청 단위 작업)의 결과로 시나리오를 만들 때: 가드를 통과했으면 `REVIEW_REQUIRED`, 3회 안에 통과하지 못했으면 `GUARD_FAILED`이다. `GUARD_RETRY`는 시나리오 1건 재생성 작업이 진행 중일 때만 나타난다. AI 작업 `progress.attempt`가 2 이상이면 `GUARD_RETRY`, 1이면 `GENERATING`으로 표시한다.
- 가드 결과는 `guard`(`attempt`, `message`, `failures`, `catalogGap`)에 저장한다. `catalogGap`이 참이면 재생성으로 해결되지 않으므로 카탈로그 수정이 필요하다고 표시한다.
- **재생성이 실패하면**(AI 작업 실패, 결과 형식 검증 실패) 시나리오 내용과 케이스는 바꾸지 않는다. 직전 가드 결과가 통과였으면 `REVIEW_REQUIRED`, 아니면 `GUARD_FAILED`로 돌아가고 실패 사유는 `guard.message`에 둔다. 가드를 통과하지 못한 시나리오가 재생성 실패를 거쳐 승인 가능한 상태가 되지 않게 하기 위해서다. 따라서 `GENERATING`·`GUARD_RETRY`에서 `REVIEW_REQUIRED` 또는 `GUARD_FAILED`로 가는 것은 재생성 결과(성공 또는 실패)로만 일어난다.
- **`GUARD_FAILED`를 사람이 수정하면**(`updateScenario`, `updateTestCase`) `REVIEW_REQUIRED`가 된다. 직전 AI 가드 결과(`guard.failures`, `catalogGap`)는 지우지 않고 "이전 생성의 가드 결과"로 남긴다. 사람이 고친 내용은 AI 가드를 다시 거치지 않으며, 실행 전에 M3의 TestQuery 가드(`startTestQueryGeneration`)가 카탈로그·명세와 다시 대조한다.
- 재생성은 시나리오 코드(`SC-xx`)를 유지하고 version을 올린다. 기존 케이스는 비활성(`isActive=false`)으로 남기고 새 케이스는 요청 안에서 쓴 적 없는 `TC` 번호를 받는다. 실행 기록이 기존 케이스를 참조하므로 지우지 않는다.

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
- 플랫폼 전체에서 진행 중인 실행(`PREPARING`, `RUNNING`, `CANCELLING`)은 1개다. 다른 프로젝트 것이라도 있으면 `409 RUN_ALREADY_ACTIVE`를 반환한다 (ADR-023 U3). 실행기가 한 번에 1건만 실행하므로 보이지 않는 대기 상태를 만들지 않기 위해서다.
- 케이스 하나의 TestQuery 생성이나 변환이 3회 실패하면 그 케이스만 `ERROR`(`TEST_CODE_ERROR`)로 두고 나머지는 계속 실행한다. "3회"는 다음과 같이 센다.

  | 결과 | 백엔드 동작 |
  |---|---|
  | AI 결과 `guard.passed=false` | 다시 요청하지 않고 바로 `ERROR`. AI가 이미 안에서 가드 재생성을 최대 3회 했기 때문이다. 사유는 가드 실패 문장 |
  | 실행기 `renderSpec`이 `compileStatus=FAILED`이거나 422(스키마 위반) | 오류를 `previousError`에 넣어 AI에 다시 요청. 첫 요청 포함 최대 3회 |
  | AI 작업 실패, `error.retryable=true` | 다시 요청. 위와 같은 3회 안에서 센다 |
  | AI 작업 실패, `error.retryable=false` | 다시 요청하지 않고 바로 `ERROR` |
  | `dbChecks[].path`가 `queryApiBaseUrl`의 경로로 시작하지 않음 | 준비 단계에서 그 케이스를 `ERROR`(`TEST_CODE_ERROR`, 벗어난 경로를 사유에 기록)로 두고 실행기·대상 사이트를 부르지 않는다. 읽기 전용 조회 API 밖을 부르지 않기 위해서다 |

- 프로젝트에 `queryApiBaseUrl`이 없으면 DB 단계(BEFORE, AFTER)를 실행하지 않고 `SKIPPED`로 둔다. 이때 교차 검증의 DB 값 처리는 아래 "API 검사와 교차 검증 판정"을 따른다.
- 케이스 실행이 시간 제한(`timeoutMs`, 기본 120초)을 넘거나 요소·응답을 기다리다 시간이 다 되면 그 시도는 `FAILED` + `failureType` `TIMEOUT`이다. `ERROR`가 아니다. 대상 사이트가 응답은 하지만 기대한 상태에 이르지 못한 것이므로 제품 쪽 실패로 본다. 첫 접속부터 연결이 안 되는 경우는 아래 규칙대로 `ERROR`다.
- 실행기나 대상 사이트에 아예 접속할 수 없으면 남은 케이스를 멈추고 실행을 `ERROR`로 끝낸다.
- 실행기 응답별 백엔드 처리 (케이스의 최종 판정은 `getExecution`의 `failureType`·`failureMessage`를 쓰고, 마지막 `status` 이벤트 값은 표시용이다):

  | 실행기 응답 | 처리 |
  |---|---|
  | `422 INVALID_REQUEST`, `422 INVALID_TEST_QUERY` | 그 케이스 `ERROR`(`TEST_CODE_ERROR`) |
  | `422 TARGET_NOT_ALLOWED` | 실행(Run) `ERROR`. 대상 사이트에 접속할 수 없는 경우와 같다 |
  | `409 DUPLICATE_EXECUTION` | 이미 시작된 것으로 보고 그 실행을 계속 조회 |
  | `404 EXECUTION_NOT_FOUND` (이벤트 스트림이 끝난 뒤) | 실행(Run) `ERROR`. 실행기가 재시작돼 결과를 잃은 경우다 |
  | `404 ARTIFACT_NOT_FOUND` | 증거 없이 진행하고 로그만 남김. 판정은 바꾸지 않음 |
  | 백엔드 자체 케이스 시간 제한 초과 | 실행기 시간 초과와 같이 `FAILED` + `TIMEOUT` | 시작하지 않은 시나리오·케이스는 `SKIPPED`, 사용자가 중단해 시작하지 않은 것은 `CANCELLED`이다.
- `PREPARING`에서 포함된 케이스 전부의 TestQuery 생성(AI)과 spec 변환(실행기 `renderSpec`)을 마친 뒤 `RUNNING`으로 간다. 같은 케이스 version으로 컴파일을 통과한 TestQuery가 있으면 AI를 다시 부르지 않고 그 TestQuery를 쓴다. 다만 spec은 실행 전마다 실행기 `renderSpec`으로 다시 변환한다. 결과의 렌더러 버전이 저장된 것과 다르면 그 버전의 `generated_spec`을 새로 저장하고 케이스 결과에 연결한다. 실행기가 실제로 실행하는 코드와 `getCaseResultSpec`이 보여 주는 spec이 같아야 하기 때문이다 (ADR-005). 다시 변환이 실패하면 그 실패를 "3회" 규칙의 1회로 세고, 오류를 `previousError`로 넘겨 AI 생성을 2회차부터 한다 (ADR-022).
- TestQuery 생성은 실행 작업자 안에서 AI 작업을 직접 조회하며 `async_job`에 남기지 않는다. 진행은 실행 상태와 로그가 담고, 백엔드가 재시작하면 실행을 이어 가지 않기 때문이다 (아래).
- 백엔드가 재시작하면 진행 중이던 실행은 이어서 하지 않고 `ERROR`로 끝낸다. `CANCELLING`이었으면 `CANCELLED`로 끝낸다. 시작하지 않은 시나리오·케이스는 위 규칙대로 `SKIPPED`(중단이면 `CANCELLED`)이다.
- 실행기는 한 번에 1건만 실행한다. 백엔드는 케이스 실행을 순서대로 보내며, `409 RUNNER_BUSY`(이전 실행의 정리가 덜 끝난 경우 등)는 케이스 오류가 아니라 대기 후 재시도할 신호다.
- 실행 증거는 백엔드가 실행기에서 가져간다(`getExecutionArtifact`). 스크린샷은 `screenshot` 이벤트를 받는 즉시, trace·HAR는 실행이 끝난 뒤 가져와 `run-artifacts/...` 키로 저장소(S3 또는 local)에 두고 `artifact` 행을 만든다 (ADR-023 U1).
- 테스트 데이터 값은 저장된 TestQuery·spec에 넣지 않는다. 실행할 때마다 백엔드가 현재 활성 TEST_DATA에서 `variables`, `secretVariables`를 채운다. TestQuery가 참조하는 이름이 지금 TEST_DATA에 없으면 그 케이스의 TestQuery를 다시 만든다 (ADR-020: TEST_DATA 변경은 지식 베이스를 STALE로 만들지 않으므로 여기서 확인한다).

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

- **활성 케이스가 없는 시나리오**(재생성 등으로 모두 비활성)는 실행하지 않고 `WAITING → SKIPPED`로 둔다.
- **`PREPARING`에서 TestQuery 생성·변환에 실패한 케이스**는 `PENDING`으로 두고 사유(`failureMessage`)만 적어 둔다. 그 시나리오를 실행할 차례가 되면 실행기를 부르지 않고 `PENDING → RUNNING → ERROR`(`failureType` `TEST_CODE_ERROR`)로 끝낸다. 화면의 진행 순서와 `case.status` 이벤트가 다른 케이스와 같은 흐름을 따르게 하기 위해서다. `PENDING → ERROR`로 바로 가는 전이는 없다.

케이스가 실패하면 최대 3회까지 실행해 재현 횟수를 기록한다 (UI-04 "3회 중 3회"). 3회 중 1회라도 통과하면 `PASSED`가 아니라 `FAILED`로 두고 재현 횟수로 불안정함을 드러낸다. 성공 기준의 오탐률 산정을 흐리지 않기 위해서다.

## 케이스 실행 순서 (WBS 4.3.9)

```text
데이터 초기화(SETUP) → DB 사전 조회(BEFORE) → 실행기 실행(UI/API)
  → DB 사후 조회(AFTER) → 교차 검증(ASSERT) → 데이터 정리(TEARDOWN)
```

중간 단계가 실패해도 정리 단계는 수행한다. 다음 케이스의 사전조건이 오염되지 않게 하기 위해서다.

TEARDOWN은 데이터 초기화 API(`POST {testControlUrl}/reset`)를 한 번 더 부르는 것이다. 대상 사이트 계약에 별도 정리 API가 없기 때문이다. 정리가 실패하면 로그(`log`, kind `TEARDOWN`)와 단계 상태만 남기고 케이스 판정은 바꾸지 않는다 (ADR-022).

## API 검사와 교차 검증 판정

API 단계는 다음 순서로 검사한다. 앞 단계가 실패하면 뒤 단계는 하지 않는다.

| 순서 | 검사 | 실패 시 `failureType` |
|---|---|---|
| 1 | `expectStatus` 상태 코드 | `API_ERROR` |
| 2 | `responseSchema` 응답 구조 | `API_SCHEMA_MISMATCH` |
| 3 | `expectCapture` 기대값 | `ASSERTION_FAILED` |
| 4 | `crossChecks` 화면·API·DB 비교 | `DATA_MISMATCH` |

`schemaCheck`는 `PASSED`, `FAILED`, `NOT_CHECKED` 중 하나다. 명세에 응답 구조가 없으면 `NOT_CHECKED`이며, 통과로 세지 않는다.

`crossChecks` 판정은 정규화한 값으로 다음과 같이 정한다. 먼저 **설정이 없어 건너뛴 출처**를 비교에서 뺀다. 지금은 프로젝트에 `queryApiBaseUrl`이 없어 DB 단계가 `SKIPPED`인 경우의 DB 출처(`dbCheckId`)가 이에 해당하며, 그 행의 `dbValue`는 null이다. 남은 출처로 아래 표를 적용한다.

| 조건 | 판정 |
|---|---|
| 남은 출처가 없음 (모든 출처를 건너뜀) | `NOT_APPLICABLE` |
| `consistencyOnly`인데 남은 출처가 1개뿐 | `NOT_APPLICABLE` (같은지 비교할 상대가 없음). `expected`가 있는 항목은 남은 출처가 1개여도 아래 표대로 `expected`와 비교한다 |
| 지정한 출처의 값을 실행 중에 얻지 못함 (캡처 실패, DB 조회 실패) | `MISMATCH` |
| 값들이 서로 다름 | `MISMATCH` |
| 값들이 같지만 `expected`와 다름 | `MISMATCH` |
| 값들이 같고 `expected`와 같음 | `MATCH` |
| `consistencyOnly`이고 값들이 서로 같음 | `MATCH` |
| 비교할 출처가 처음부터 지정되지 않음 | `NOT_APPLICABLE` |

설정 누락을 결함으로 세지 않고(오탐률), 실행 중 실패는 숨기지 않기 위해 둘을 구분한다 (리더 승인, 2026-11-10).

## 실패 원인 분석 (UI-04, FR-06)

`case_result.analysis_status`(`AnalysisStatus`)로 관리한다. 실행 끝 상태와 리포트는 분석을 기다리지 않는다.

```text
NOT_REQUIRED                       (PASSED, ERROR, SKIPPED, CANCELLED 케이스)
PENDING → RUNNING → COMPLETED      (FAILED 케이스, 실행이 끝난 뒤 AI startFailureAnalysis)
                  ↘ FAILED         (AI 작업 실패. analysisError에 사유, 원인 후보 없음)
```

| 값 | 화면 표시 (UI-04 원인 후보 영역) |
|---|---|
| `NOT_REQUIRED` | 영역 숨김 |
| `PENDING`, `RUNNING` | 분석 중 |
| `COMPLETED` | 원인 후보 목록. 후보가 0개면 "근거 있는 원인 후보를 찾지 못했어요" |
| `FAILED` | 분석 실패 + 사유 |

- `failureType`은 규칙으로 정한다: 실행기 결과(`ELEMENT_NOT_FOUND`, `TIMEOUT`, `API_ERROR`, `API_SCHEMA_MISMATCH`, `ASSERTION_FAILED`, `TEST_CODE_ERROR`, `ENVIRONMENT_ERROR`)가 우선이고, 실행기는 통과했지만 교차 검증이 `MISMATCH`면 `DATA_MISMATCH`다. AI 분석은 `severity`, `affectedFeatures`, `rootCauses`만 채운다.
- 원인 후보는 근거(`evidence`)가 요청에 실제로 있는 값일 때만 저장한다. 역할 분담: **AI**가 요청에 있는 실제 값만 인용하고 근거 없는 후보를 내지 않는다(ai-api `FailureAnalysisResult`). **백엔드**는 `evidence`가 비어 있지 않은지만 검사해 빈 후보를 버리고, rank 순으로 최대 5개 저장한다. 근거 문장이 요청 값과 실제로 일치하는지는 백엔드가 다시 검사하지 않는다 (ADR-022).
- 분석 작업(`PENDING`)은 실행을 끝 상태로 바꾸기 **전에** 만든다. 끝난 실행을 조회하는 쪽이 FAILED 케이스의 분석 상태를 항상 `PENDING` 이상으로 보게 하기 위해서다.
- **MVP 한계:** 브라우저 콘솔 오류는 실행기가 로그로만 남기고 저장하지 않으므로 분석 요청의 `consoleErrors`에 들어가지 않는다. 콘솔 오류로만 드러나는 원인(스크립트 예외 등)은 원인 후보에 잘 나오지 않을 수 있다.
- **실패 지문**(`failure_fingerprint`) = SHA-256(케이스, `failureType`, 마지막 실패 시도의 첫 실패 단계의 종류·제목, 그 단계의 기대·실제 값, 교차 검증 불일치 항목 이름). 실행을 끝 상태로 바꾸기 직전에 FAILED 케이스마다 계산한다. 같은 케이스가 같은 단계에서 같은 값으로 실패해야 "같은 실패"로 본다.

## 이전 실행 대비 (UI-04, FR-07, ADR-013)

| 항목 | 규칙 |
|---|---|
| 비교 대상 | 재실행이면 `rerunOfRunId`의 실행. 아니면 같은 테스트 요청에서 이 실행 전에 끝난(`PASSED`, `FAILED`, `ERROR`) 가장 최근 실행. 없으면 비교하지 않음 |
| 비교 단위 | 테스트 케이스(`test_case_id`). 두 실행 모두에 있는 케이스만 `resolved`, `continuingFailures` 대상 |
| `newFailures` | 이번에 `FAILED`이고 이전에는 `FAILED`가 아님(통과, 미포함 포함) |
| `continuingFailures` | 이전과 이번 모두 `FAILED` |
| `resolved` | 이전에 `FAILED`, 이번에 `PASSED` |
| `previousCasePassRatePct` | 비교 대상 실행의 `casePassRatePct` |
| `firstSeenRunCode` | 비교 대상 실행에서 같은 케이스가 같은 `failure_fingerprint`로 `FAILED`였으면 그 실행의 `firstSeenRunCode`를 이어받고(그 실행에 값이 없으면 그 실행), 아니면 이번 실행 ("이번 실행"). 비교 대상이 없어도 이번 실행. 비교 대상의 케이스가 `FAILED`인데 지문이 없으면(지문 계산 전에 끝난 실행) 저장된 단계·교차 검증으로 그 자리에서 같은 방식으로 계산해 비교하며, 계산한 값을 이전 행에 저장하지는 않는다 |

`ERROR` 케이스는 실패로 세지 않는다 (위 Run 규칙과 같음).
