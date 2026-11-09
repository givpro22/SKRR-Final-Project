# 기술 결정 기록

상태: **확정**(사용자 또는 팀 문서가 정함), **제안**(하네스가 근거를 들어 제안, 팀 검토 필요), **미정**(결정 필요).
제안 항목은 그대로 진행하되, 팀이 뒤집으면 이 문서를 먼저 고치고 영향받는 계약을 갱신한다.

## 기술 스택

| 영역 | 기술 | 상태 | 근거·용도 |
|---|---|---|---|
| 프론트 | React, TypeScript (strict), Vite | 확정 | 사용자 결정. `develope` 베이스라인은 JSX이므로 TS로 시작 |
| 프론트 | React Router | 제안 | 화면 5개와 상세 경로 |
| 프론트 | TanStack Query | 제안 | 서버 상태, 생성 중 2초 조회, 캐시 무효화 |
| 프론트 | openapi-typescript, openapi-fetch | 제안 | 명세에서 타입 생성. API와 화면의 불일치를 컴파일 시점에 잡음 |
| 프론트 | MSW | 제안 | WBS 4.4.1 더미 데이터 단계. 백엔드 없이 계약대로 개발 |
| 프론트 | Tailwind CSS | 확정 | 사용자 결정 (2026-11-09). `harness/context/ui-screens.md`의 토큰을 테마로 등록해 사용 |
| 프론트 | lucide-react, Vitest, Testing Library | 제안 | 캡처와 유사한 선 아이콘, 단위·컴포넌트 테스트 |
| 백엔드 | Java 21, Spring Boot 3.3, Maven | 확정 | 사용자 결정(Spring Boot). 버전은 `develope` 베이스라인 |
| 백엔드 | Spring Web, Validation, Actuator, AWS SDK v2 (S3, Presigner) | 제안 | API, 입력 검증, 쿠버네티스 프로브, S3 |
| 백엔드 | Spring Data JPA, Flyway | 제안 | ERD 구현과 스키마 이력 |
| 백엔드 | springdoc-openapi | 확정 | WBS 4.1.4, 4.3.5가 Swagger를 요구 |
| 백엔드 | JUnit 5, Testcontainers | 제안 | 실제 PostgreSQL로 통합 테스트 |
| DB | PostgreSQL 16 | 제안 | ADR-003 |
| AI | Python 3.12, FastAPI, Pydantic v2 | 확정 | 사용자 결정(Python), 아키텍처 그림(FastAPI) |
| AI | LangGraph | 제안 | WBS 4.3.6 비고. 가드 재생성 루프를 그래프로 표현 |
| AI | sqlite-vec | 확정 | WBS 4.5.2, PoC에서 사용 |
| AI | boto3, httpx, tenacity, pypdf, python-docx, PyYAML | 제안 | S3(아키텍처 그림), LLM 호출과 재시도(WBS 4.6.3), 문서 파싱 |
| AI | pytest, ruff, mypy | 제안 | 테스트와 정적 검사 |
| 실행기 | 별도 서버, Node 22, TypeScript, @playwright/test | 확정 | 사용자 결정 (2026-11-09). ADR-005 |
| 실행기 | Fastify | 제안 | 실행기 내부 API 서버 |
| 인프라 | Docker, Kubernetes | 확정 | 사용자 결정 |
| 인프라 | Kustomize, Traefik, kind, kubeconform | 제안 | ADR-008 |
| 저장소 | Amazon S3 | 확정 | 아키텍처 그림, `develope`에 연동 구현 |
| LLM | 미정 | 미정 | ADR-010 |

## ADR-001 작업 영역은 프론트, 백엔드, AI, 인프라 — 확정

사용자 결정. 실행기(`runner/`)는 코드는 AI 영역, 이미지와 배포는 인프라 영역이 맡는다.

## ADR-002 저장소 구조 — 저장소는 확정 (사용자, 2026-11-09), 폴더 구조는 제안

코드는 `givpro22/SKRR-Final-Project`에 둔다. 이 저장소는 공개 상태이므로 비밀값과 비공개 저장소의 코드를 커밋하지 않는다.

```text
frontend/  backend/  ai/  runner/  infra/  docs/contracts/  harness/
```

한 저장소에 모은다. 계약 변경과 구현 변경을 한 PR로 묶을 수 있고, QA가 양쪽 코드를 동시에 비교하기 쉽다. `JHuiJung/SKALA-Final-Project`는 참고 자료로만 쓰며 코드를 그대로 옮기지 않는다.

## ADR-003 플랫폼 DB는 PostgreSQL — 제안

WBS 4.1.3이 DB 선택을 요구했다. 시나리오와 이벤트에 JSONB가 필요하고, 부분 유니크 인덱스로 "활성 문서 1개" 같은 규칙을 DB에서 보장할 수 있다. Testcontainers와 쿠버네티스 환경 모두에서 널리 쓰여 위험이 낮다.

## ADR-004 벡터 저장소는 sqlite-vec, AI 서버는 1 레플리카 — 확정 (WBS) / 제안 (운영)

파일 기반이므로 쿠버네티스에서 `ReadWriteOnce` PVC를 쓰고 AI 서버를 1개로 고정한다. 인덱스가 사라져도 S3 원본으로 다시 만들 수 있다. 프로젝트별 파일 `/data/kb/{projectId}.sqlite`로 나눠 재구축 범위를 줄인다.

## ADR-005 LLM은 코드를 쓰지 않고, 실행기가 TestQuery를 변환한다 — 제안 (실행기 분리와 Node는 확정)

실행기를 백엔드와 분리된 Node 서버로 두는 것은 사용자가 확정했다 (2026-11-09). Java 실행기와 백엔드 내장 방식을 비교한 뒤 고른 결정이다.

**핵심 결정이다.** LLM이 Playwright 코드를 직접 쓰면 두 가지 문제가 있다.

1. FR-04의 "100% 실행 가능, 문법 검사 통과"를 보장할 수 없다.
2. LLM 출력이 코드로 실행되는 보안 위험이 생긴다. `ops-test` PoC의 README도 AI가 만든 코드를 그대로 실행하면 안전하지 않다고 경고한다.

그래서 흐름을 이렇게 나눈다.

```text
AI 서버: 케이스 → TestQuery JSON (허용된 동작만, 카탈로그·명세로 가드 검증)
실행기: TestQuery → spec.ts 변환 (결정적, 값은 안전하게 이스케이프) → tsc 검사 → 실행
```

선택자는 `data-testid`로 제한한다. 가드가 카탈로그에 있는 요소만 통과시키므로 화면 요소 환각을 차단한다. 실행기는 별도 컨테이너로 두고 다음으로 격리한다.

- 비루트 실행, DB 자격 증명·AWS 키 없음, 증거는 presigned URL로 업로드
- 수신은 백엔드만, 송신은 허용된 대상과 S3(443)만
- `RUNNER_ALLOWED_TARGET_HOSTS`에 있는 호스트만 접속 (제외 범위인 운영 시스템 차단)
- 한 번에 1건 실행, 실행별 임시 디렉터리, 시간 제한

`.spec.ts`는 UI-03과 UI-04의 `sc-03.spec.ts`, `tc-12.spec.ts` 표기와 맞다.

## ADR-006 실시간 전달은 SSE — 제안

WBS 4.3.6이 SSE와 WebSocket 중 선택을 남겨 뒀다. 실행 이벤트는 서버→화면 단방향이고, 중단과 재실행은 일반 API로 충분하다. 재연결이 표준에 있고(`Last-Event-ID`) 프록시 구성도 단순하다. 조건으로 프론트 nginx의 버퍼링을 끄고 읽기 시간 제한을 늘리며, Ingress를 거쳐도 스트림이 끊기지 않는지 확인해야 한다.

## ADR-007 실행 제어는 백엔드, 작업 큐 없음 — 제안

WBS 4.3.3~4.3.10이 데이터 준비, DB 검증, 실행 제어를 백엔드에 배정했다. AI 서버와 실행기는 상태를 DB에 쓰지 않는다. MVP 규모에서는 Kafka나 Redis 없이 Spring 스레드 풀과 `async_job`, `run_event` 테이블로 충분하다. SSE 구독이 메모리에 있으므로 백엔드도 1 레플리카로 시작한다.

## ADR-008 배포는 Kustomize, 로컬 검증은 kind — 제안 (쿠버네티스·도커는 확정)

`infra/k8s/base`와 `overlays/{local,dev}`로 나눈다. Helm보다 학습 부담이 적고 템플릿 없이 YAML을 그대로 검증할 수 있다. Docker Compose는 `develope` 구성을 참고해 로컬 개발 편의용으로만 유지한다.

Ingress 컨트롤러는 Traefik을 쓴다. `ingress-nginx`는 2026년 3월에 지원이 종료되어 보안 패치가 나오지 않으므로 쓰지 않는다 (2026-11-09 Kubernetes 공식 공지로 확인). 표준 Ingress 리소스와 Traefik Middleware로 충분해 Gateway API보다 구성이 단순하다. 프론트 컨테이너 안의 nginx 웹 서버는 이 지원 종료와 무관하며, 업로드 제한과 SSE 설정은 그 nginx에 둔다.

WBS에 플랫폼 배포 작업이 없으므로 추가해야 한다.

## ADR-009 브라우저는 백엔드만 호출 — 제안

아키텍처 그림은 프론트→백엔드→AI 흐름이다. `develope`의 nginx에 있는 `/api/ai/` 직접 경로는 만들지 않는다. nginx는 `/api/`를 백엔드로만 보낸다.

## ADR-010 LLM 제공자 — 미정

요구사항서는 "LLM API"를, PoC는 로컬 Ollama를 쓴다. 코드는 `LLM_PROVIDER` 환경변수로 교체할 수 있는 인터페이스로 작성해 이 결정이 구현을 막지 않게 한다.

| 선택지 | 장점 | 단점 |
|---|---|---|
| 호스팅 API | GPU 불필요, 쿠버네티스 구성 단순, 품질 높음 | 비용, 키 관리 |
| Ollama | 비용 없음, 키 불필요, PoC 재사용 | GPU 필요, 지연 큼, 품질 편차 |

호스팅 API를 고르면 비용·품질 확인 후 모델을 정한다. 성공 기준(원인 1순위 70% 등)을 평가 세트로 비교한 뒤 결정하기를 권한다.

## ADR-011 MVP 인증은 Ingress Basic Auth — 확정 (사용자, 2026-11-09)

요구사항서와 화면에 로그인이 없다. 하지만 파일 삭제와 실행 API를 인증 없이 공개하면 위험하다. 앱 코드에 인증을 넣지 않고 Traefik BasicAuth Middleware로 막으며, 사용자는 초기 데이터의 기본 계정을 쓴다. 팀이 로그인 화면을 원하면 이 결정을 다시 연다.

## ADR-013 MVP 범위 — 확정 (사용자, 2026-11-09)

| 항목 | 결정 | 구현 방향 |
|---|---|---|
| 로그인 화면 | 만들지 않음 | ADR-011. 사용자는 초기 데이터의 기본 사용자 1명이며, 실행자도 이 이름으로 표시 |
| GitHub 주소 입력과 Clone | 제외 | 파이프라인 그림에만 있음. 입력은 FR-01의 문서와 URL로 한정 |
| 리포트 PDF 내보내기 | MVP 이후 | 계약에는 `x-priority: later`로 유지. 구현하지 않고 버튼도 표시하지 않음 |
| 이전 실행 대비 비교 | 포함 | `RunComparison` 구현. WBS 4.7에 작업 추가 필요 |

## ADR-012 자료가 충돌할 때의 우선순위 — 제안

1. 사용자가 직접 정한 내용, 2. 이 문서의 결정, 3. 요구사항서, 4. WBS, 5. UI 캡처, 6. 파이프라인·아키텍처 그림, 7. `develope` 베이스라인.

확인된 충돌의 처리는 다음과 같다.

| 충돌 | 처리 |
|---|---|
| 같은 `SC` 번호가 화면마다 다른 내용 | 캡처 값은 예시로 본다. 계약은 요청 단위 번호로 통일 |
| 후보는 1개 선택인데 완료 모달은 "시나리오 2개" | 후보 1개에서 시나리오 여러 개가 나올 수 있다. 문구는 "시나리오 N개, 테스트 케이스 M개를 만들었어요"로 바꾼다 |
| 파이프라인 그림의 GitHub 입력과 Clone | MVP에서 제외 (ADR-013) |
| 파이프라인 그림에 승인 단계 없음 | 요구사항서대로 승인 필수 |
| 그림은 Docker Compose, 팀 역할은 쿠버네티스 | 쿠버네티스로 확정. Compose는 로컬 개발용 |
| 플랫폼 ERD, API 명세 없음 | 이 저장소의 `docs/contracts/`가 초안 |
| WBS는 테스트 사이트 ERD·API 완료, 자료는 폴더에 없음 | 받으면 `harness/references/`에 추가. 그 전에는 `target-site-contract.md`의 형식으로 목업 사용 (WBS 4.5.1) |
