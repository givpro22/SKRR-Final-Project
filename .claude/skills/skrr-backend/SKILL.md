---
name: skrr-backend
description: "SKRR 플랫폼 백엔드를 Java Spring Boot로 구현·수정한다. REST API, JPA 엔티티, Flyway 마이그레이션, S3 업로드, AI 서버·실행기 연동, 테스트 실행 제어, DB 교차 검증, SSE, 리포트 집계, backend 폴더 작업을 요청하면 반드시 이 스킬을 사용할 것. 대상 쇼핑몰 서버나 AI 프롬프트 작업에는 쓰지 않는다."
---

# 백엔드 구현

## 시작 전에

`docs/contracts/` 전체와 `docs/architecture.md`를 읽는다. 작업에 해당하는 WBS 4.3 완료 기준은 `pdftotext -layout`으로 WBS PDF에서 확인한다.

## 스택

Java 21, Spring Boot 3.3, Maven Wrapper, Spring Web, Validation, Data JPA, Flyway, PostgreSQL, Actuator, springdoc-openapi, AWS SDK v2(S3, Presigner), JUnit 5, Testcontainers, WireMock. 로컬에 `mvn`이 없을 수 있으므로 Maven Wrapper를 저장소에 포함한다. 패키지 루트는 `com.skrr.platform`이다.

## 폴더 구조

영역별로 나눈다. 기술별 대형 패키지를 만들면 관련 코드가 흩어지기 때문이다.

```text
com.skrr.platform/
  common/     오류 처리(problem+json), 설정, 시간
  project/    프로젝트, 활동 로그
  document/   문서, S3 저장
  knowledge/  지식 베이스 상태
  request/    테스트 요청, 후보
  scenario/   시나리오, 케이스, 상태 전이
  run/        실행 제어, 이벤트, SSE, 교차 검증
  report/     리포트 집계, 비교
  client/     ai/, runner/, target/ 외부 호출
```

## API 구현

- 경로, 필드, 상태 코드는 `platform-api.openapi.yaml`과 같게 한다. 요청·응답 DTO를 엔티티와 분리한다.
- 입력 검증은 명세의 길이 제한과 같게 맞춘다 (요청 500자, 파일 20MB). Spring은 `max-file-size: 20MB`, `max-request-size: 21MB`로 둔다. multipart 본문이 파일보다 조금 커서, 같은 값으로 두면 정확히 20MB인 파일이 거부된다.
- 오류는 `ProblemDetail` + `code`로 응답한다.
- springdoc의 `/v3/api-docs` 출력과 계약을 비교해 달라진 점이 없게 한다 (WBS 4.3.5). 명세에서 `x-priority: later`인 API는 MVP에서 구현하지 않으므로 비교에서 뺀다.
- 로그인이 없다 (ADR-011, ADR-013). Flyway로 기본 사용자 1명을 넣고, `getCurrentUser`와 `started_by`, `created_by`는 이 사용자를 쓴다. 나중에 인증을 넣기 쉽도록 현재 사용자 조회를 한 클래스에 모은다.

## DB

`docs/contracts/schema.sql`을 `V1__init.sql`로 옮기고, 이후 변경은 새 버전 파일로 한다. 적용된 파일은 수정하지 않는다. JPA는 `ddl-auto: validate`로 두어 엔티티와 스키마 불일치를 시작 시점에 잡는다. 표시 코드 번호(`seq`)는 동시 요청에도 겹치지 않도록 프로젝트 행을 잠근 뒤 발급한다.

## 상태 전이

전이 규칙은 각 상태 enum이나 전용 클래스 한곳에 모으고, 서비스 코드에서 직접 `setStatus`를 호출하지 않는다. 표에 없는 전이는 409 `INVALID_STATE_TRANSITION`이다. 승인 뒤 내용이 바뀌면 승인을 풀고 `version`을 올린다.

## 비동기 작업과 AI 연동

```text
요청 → async_job 저장 → AI 서버 202 → 스케줄러가 getAiJob 조회 → 결과 저장, 상태 전이
```

- 호출마다 연결·읽기 시간 제한을 둔다.
- 앱이 재시작되면 열린 `async_job`을 이어서 조회한다.
- 조회가 404면 AI 서버가 재시작해 작업을 잃은 것이므로 1회 재요청하고, 다시 실패하면 `FAILED`로 끝낸다.
- `retryable: false`인 오류는 재시도하지 않는다.
- 생성 결과는 받은 뒤 코드(`SC-`, `TC-`)를 검증해 저장한다.

## 실행 제어 (WBS 4.3.9)

Spring 스레드 풀에서 실행하며, 프로젝트당 진행 중인 실행은 1개다. 순서는 `state-machines.md`를 따른다.

```text
1 PREPARING: 승인 케이스마다 generated_spec 확인. 없으면 AI로 TestQuery 생성 → 실행기 render
   같은 케이스 버전의 spec이 있으면 재사용한다.
   render 실패 시 오류를 previousError로 넘겨 AI에 재요청 (최대 3회)
2 RUNNING: 케이스마다
   a POST {testControlUrl}/reset
   b dbChecks BEFORE 조회
   c TEST_DATA 문서 값 채우기 → presigned URL 발급 → runner startExecution → 이벤트 수신
   d dbChecks AFTER 조회
   e crossChecks로 verification 계산
   f 정리 (앞 단계가 실패해도 수행)
   g 실패면 최대 3회까지 a~f를 반복해 재현 횟수 기록
3 실패 케이스마다 failure-analyses 호출
4 집계 후 끝 상태 전이
```

- 중단 요청은 단계 사이에서 확인하고, 실행 중이면 `cancelExecution`을 호출한다.
- `dbChecks`는 `queryApiBaseUrl` 기준 **GET만** 수행한다.
- 교차 검증은 `normalize` 규칙을 적용해 비교한다 (`₩87,400` = `87400`). 값을 얻지 못한 칸은 `null`이며 일치로 처리하지 않는다.
- 판정은 수집한 값으로 계산한다. AI 분석은 원인 후보만 제공한다.
- 실행기나 AI 장애는 `ERROR`이고 테스트 실패는 `FAILED`다. 구분이 무너지면 오탐률 평가가 틀어진다.

## SSE (WBS 4.3.6)

`run_event`에 먼저 저장하고 `SseEmitter`로 전달한다. 저장을 먼저 해야 재연결 때 복구할 수 있다.

- 시작 위치는 `Last-Event-ID`, 없으면 `afterSeq`다. 그 이후 이벤트를 다시 보낸 뒤 실시간으로 넘어간다. 이 사이의 유실과 중복을 테스트한다.
- 15초마다 `heartbeat`, 끝난 실행은 종료 이벤트 후 연결을 닫는다.
- emitter 타임아웃과 정리를 처리해 메모리 누수를 막는다. 응답에 `X-Accel-Buffering: no`를 넣는다.

## S3

- 키 구조는 `docs/architecture.md`를 따르고 파일명에서 경로 문자를 제거한다.
- 자격 증명은 SDK 기본 체인에 맡긴다.
- 다운로드와 실행기 업로드는 presigned URL을 쓰고 유효 시간을 짧게 둔다.

## 리포트 (WBS 4.7, 4.3.10)

지표는 DB 값에서 계산한다. `failure_fingerprint`(케이스 + 실패 유형 + 실패 단계)로 직전 실행과 비교해 새로운 실패, 계속 실패, 해결됨을 만든다. 숫자는 `kpis`, `scenarios`, 케이스 목록 사이에서 서로 맞아야 한다.

## 테스트

| 대상 | 방법 |
|---|---|
| 상태 전이 | 허용과 거부를 모두 단위 테스트 |
| API, DB | `@SpringBootTest` + Testcontainers |
| AI, 실행기, 대상 사이트 | WireMock으로 계약 응답과 오류, 시간 초과 재현 |
| 실행 제어 | 정상, 실패 재현 3회, 중단, 실행기 장애(`ERROR`), 정리 단계 실행 보장 |
| SSE | 재연결 복구, 중복 없음 |

## 완료 전 검증

```bash
./mvnw verify
```

Testcontainers에는 Docker가 필요하다. Docker가 없으면 해당 테스트를 미검증으로 보고한다. 끝나면 `frontend-engineer`와 `qa-inspector`에게 구현한 `operationId`를 알린다.
