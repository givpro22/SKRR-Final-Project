# 실행 실시간 이벤트 계약 (SSE)

`GET /api/v1/runs/{runId}/events` 의 형식이다. UI-03 실행 모니터와 WBS 4.3.6의 근거 문서이며, SSE를 고른 이유는 `docs/decisions.md` ADR-006에 있다.

## 전송 규칙

```text
id: 18342
event: step.status
data: {"runId":"...","occurredAt":"2026-11-06T01:52:38Z", ...}

```

- `id`는 `run_event.seq`다. 끊겼다 다시 연결하면 브라우저가 `Last-Event-ID`를 자동으로 보내고, 서버는 그 이후 이벤트를 저장소에서 다시 보낸다.
- 첫 화면은 `GET /runs/{runId}` 스냅샷을 먼저 그리고, `GET /runs/{runId}/events?afterSeq={lastEventSeq}`로 연결한다. 이벤트 유실과 중복 표시를 함께 막기 위해서다. 브라우저 `EventSource`는 첫 요청에 헤더를 지정할 수 없으므로 쿼리 파라미터를 쓴다. 둘 다 오면 `Last-Event-ID`를 우선한다.
- 15초마다 `heartbeat`를 보낸다. 프록시 타임아웃으로 연결이 끊기지 않게 하기 위해서다. `heartbeat`는 `run_event`에 저장하지 않는다.
- 실행이 끝난 상태의 `run.status`를 보낸 뒤 서버가 연결을 닫는다. 프론트는 이때 재연결하지 않는다.
- 모든 `data`에는 `runId`, `occurredAt`이 들어간다.
- `stepId`는 `RunStep.id`(UUID)다. 실행기 이벤트의 TestQuery 단계 id(`add_to_cart` 같은 값)를 백엔드가 `run_step`으로 바꿔 보낸다.
- 실행기 이벤트(`runner-api` `ExecutionEvent`)는 백엔드가 받아 아래 이벤트로 바꾸고 `run_event`에 저장한 뒤 보낸다. SETUP, DB, ASSERT, TEARDOWN 단계 이벤트는 백엔드가 직접 만든다.
- 브라우저 콘솔 오류는 실행기 `log` 이벤트로 받은 것만 `log`로 기록한다. 이벤트 스트림이 끊겨 빠진 것은 실행이 끝난 뒤 최종 `Execution.consoleErrors`에서 보충하며, 이미 기록한 것은 다시 기록하지 않는다.

## 이벤트 종류

| event | 추가 필드 | 화면 반영 (UI-03) |
|---|---|---|
| `run.status` | `status: RunStatus`, `progress` (RunDetail.progress와 같은 구조), `errorMessage?` | 상단 LIVE 배지, 진행 막대, 종료 시 리포트 이동 |
| `scenario.status` | `scenarioRunId`, `code`, `status: ScenarioRunStatus`, `durationMs?` | 좌측 시나리오 카드 |
| `case.status` | `caseResultId`, `code`, `status: CaseResultStatus`, `attempt`, `failedAttempts` | 시나리오 카드 내 진행 |
| `step.status` | `caseResultId`, `stepId`, `order`, `attempt`, `kind: StepKind`, `title`, `status: StepStatus`, `expectedValue?`, `actualValue?` | 단계 목록 |
| `log` | `kind: StepKind`, `message`, `caseResultId?` | 실시간 로그 패널. `UI/API/ASSERT/DB` 라벨 색상 구분 |
| `api.call` | `id`, `method`, `path`, `statusCode?`, `durationMs?` | API 호출 패널 |
| `screenshot` | `artifactId`, `caseResultId`, `stepId`, `path` (찍을 때의 페이지 경로, 예 `/checkout`) | 현재 화면 패널과 우측 상단 경로. 링크는 `getArtifactDownloadLink`로 얻음. 백엔드가 실행기에서 파일을 가져와 `artifact`를 만든 뒤 보낸다 |
| `verification` | `caseResultId`, `itemLabel`, `uiValue?`, `apiValue?`, `dbValue?`, `verdict: Verdict` | 로그의 교차 검증 표시 |
| `heartbeat` | 없음 | 표시 안 함 |

## 현재 화면의 동작

영상 스트리밍이 아니라 단계가 끝날 때마다 스크린샷을 갱신한다. `ops-test` 브랜치 PoC에서 확인한 방식이며 구현 비용이 낮다.

## 민감 정보

`log`와 `step.status`에는 `secretVariables` 값을 넣지 않는다. 실행기가 전송 전에 값을 `***`로 바꾼다.
