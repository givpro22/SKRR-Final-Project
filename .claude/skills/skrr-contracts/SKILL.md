---
name: skrr-contracts
description: "SKRR의 ERD(schema.sql), OpenAPI 명세 3종, SSE 이벤트, 상태 전이, TestQuery 스키마, 요구사항 추적표, 기술 결정 기록을 작성·수정·검토한다. API 추가, 테이블 변경, 필드 수정, 상태값 추가, 서비스 간 인터페이스 변경, ERD나 API 명세 작업을 요청하면 반드시 이 스킬을 사용할 것. 서비스 내부 구현만 바꾸는 작업에는 쓰지 않는다."
---

# 계약 작성과 변경

서비스 사이의 약속을 한곳에서 관리한다. 구현이 어긋나는 가장 흔한 원인은 양쪽이 서로 다른 문서를 보는 것이기 때문이다.

## 문서 지도

| 파일 | 내용 | 소비자 |
|---|---|---|
| `docs/contracts/schema.sql` | DB 스키마 기준 | backend |
| `docs/contracts/erd.md` | 관계도와 설계 이유 | 팀 검토 |
| `docs/contracts/platform-api.openapi.yaml` | 프론트 ↔ 백엔드 | frontend, backend |
| `docs/contracts/ai-api.openapi.yaml` | 백엔드 ↔ AI | backend, ai |
| `docs/contracts/runner-api.openapi.yaml` | 백엔드 ↔ 실행기 | backend, runner |
| `docs/contracts/schemas/test-query.schema.json` | AI → 실행기 실행 정의 | ai, runner, backend |
| `docs/contracts/events.md` | SSE 이벤트 | frontend, backend |
| `docs/contracts/state-machines.md` | 상태 전이, 실행 순서 | 전체 |
| `docs/contracts/target-site-contract.md` | 대상 사이트 조건 | ai, backend, 테스트 사이트 담당 |
| `docs/contracts/traceability.md` | 요구사항 ↔ 화면 ↔ API ↔ 테이블 ↔ WBS | 전체, QA |
| `docs/architecture.md` | 구조, 환경변수, S3 키, 제한값 | 전체 |
| `docs/decisions.md` | 기술 결정과 자료 충돌 처리 | 전체 |

## 변경 절차

1. **근거 확인:** 어떤 요구사항, WBS, 화면 때문인지 찾는다. 화면 관련이면 `harness/references/export/`의 PNG를 직접 연다.
2. **전체 영향 파악:** 값 하나가 여러 파일에 있다. 아래 표를 따라 함께 고친다.
3. **수정 후 검증:** 아래 명령을 실행한다.
4. **통보:** 영향받는 에이전트에게 바뀐 내용을 알리고 `_workspace/02_contract-architect_changes.md`에 기록한다.

| 바꾸는 것 | 함께 고칠 곳 |
|---|---|
| 상태값 | `schema.sql` CHECK, 해당 OpenAPI enum, `state-machines.md`, `harness/context/ui-screens.md` 상태 문구 |
| 테이블, 컬럼 | `schema.sql`, `erd.md`, 대응 API 스키마 |
| 플랫폼 API | `platform-api.openapi.yaml`, `traceability.md`, `ui-screens.md`의 사용 API |
| 내부 API | 해당 OpenAPI, `traceability.md` |
| SSE 이벤트 | `events.md`, `RunEventType` enum, `run_event` CHECK |
| TestQuery 동작 | 스키마, 실행기 변환기, AI 프롬프트와 가드 |
| 환경변수, 제한값 | `architecture.md`, 쿠버네티스 설정 |

## 규칙

- **API 표기:** JSON은 camelCase, DB는 snake_case, enum은 대문자, 시각은 ISO-8601 UTC.
- **오류:** `application/problem+json` + `code`. 프론트가 `code`로 분기하므로 새 코드는 `ErrorCode`에 추가한다.
- **식별자:** 경로에는 UUID, 화면에는 표시 코드(`REQ-`, `RUN-`, `SC-`, `TC-`). 대상 사이트 요구사항 ID(`FR-CART-01`)는 문자열로 저장한다. 플랫폼 요구사항 ID(`FR-01`)와 다른 체계다.
- **오래 걸리는 작업:** 202를 돌려주고 조회나 SSE로 진행을 알린다. LLM 호출을 요청 스레드에 묶어 두면 프록시 시간 제한에 걸린다.
- **상태 변경 책임:** 백엔드만 DB를 쓴다. AI 서버와 실행기는 결과를 반환한다.
- **nullable:** OpenAPI 3.1 형식 `type: [string, 'null']`을 쓴다.
- **번호 없는 API:** 요구사항 번호가 없어도 `traceability.md`의 지원 API 표에 적는다. 그래야 쓰이지 않는 API를 찾을 수 있다.

## 호환성

아직 배포 전이므로 깨는 변경이 가능하지만, 구현이 시작된 부분을 깨면 사용자에게 알리고 소비자 전원에게 통보한다. 깨는 변경에는 필드 제거, 이름 변경, 필수화, enum 값 제거, 의미 변경이 포함된다. 필드 추가는 깨지 않는 변경이다.

## 결정 기록

새 기술이나 방식을 고르면 `docs/decisions.md`에 상태와 이유를 남긴다. 사용자나 팀이 정할 사안은 **미정**으로 두고, 선택지와 장단점, 추천을 함께 적어 묻는다. 라이브러리의 최신 상태(지원 종료 여부, 버전)는 기억에 의존하지 말고 공식 문서로 확인한다.

## 검증

```bash
python3 .claude/skills/skrr-integration-qa/scripts/check_contracts.py
```

OpenAPI 문법 전체 검사는 `npx @redocly/cli lint docs/contracts/*.openapi.yaml`로 한다. `schema.sql`을 바꾸면 빈 PostgreSQL에 적용해 본다.

## 초안 표시

ERD와 API 명세는 현재 초안 v0.1이며, 담당자(ERD 황민채, API 명세 박영서) 검토 전이다. 보고할 때 검토 필요 여부를 명시한다.
