# 인프라 베이스라인

참고 저장소 `JHuiJung/SKALA-Final-Project`의 `develope` 브랜치를 2026-11-09에 읽고 요약했다. 그 저장소는 비공개이고 이 저장소는 공개 상태이므로, 구조만 적고 코드와 설정값은 옮기지 않았다. 원문이 필요하면 `gh api`로 읽는다.

## 베이스라인 구성

| 서비스 | 빌드 | 런타임 | 내용 |
|---|---|---|---|
| frontend | Node 22 alpine 멀티 스테이지 | nginx alpine, 80번 | React 18 + Vite 5 (JSX), SPA 라우팅 |
| backend | Maven + Temurin 21 멀티 스테이지 | Temurin 21 JRE, 8080번 | Spring Boot 3.3.5, AWS SDK 2.28 S3, 파일 API, 헬스 체크 |
| ai | Python 3.12 slim | uvicorn, 8000번 | FastAPI 0.115, 헬스 체크만 있음 |

Docker Compose로 띄우고 `.env`로 AWS 키, 리전, 버킷, AI 서버 주소를 주입한다.

## 가져올 것

- 서비스별 멀티 스테이지 Dockerfile
- nginx가 정적 파일을 서빙하고 `/api`를 프록시하는 구조. 쿠버네티스 Service 이름을 `backend`로 두면 같은 설정이 동작한다
- Vite 개발 프록시로 로컬에서 nginx를 대신하는 방식
- 자격 증명을 코드에 쓰지 않고 AWS SDK 기본 체인에 맡기는 방식
- S3 키에 UUID를 붙여 덮어쓰기를 막는 방식
- 업로드 제한 20MB를 프록시와 앱에 함께 거는 방식

## 바꿀 것

| 베이스라인 | 이 프로젝트 | 이유 |
|---|---|---|
| JSX | TypeScript | 사용자 결정 |
| `/api/backend/`, `/api/ai/` 경로 | `/api/`를 백엔드로만 | ADR-009 |
| `package-lock.json` 없음, `npm install` | lock 파일, `npm ci` | 빌드 재현성 |
| `healthcheck` 없이 재시작에 의존 | readiness, liveness 프로브 | 시작 순서 문제 해소 |
| 8080, 8000 포트 호스트 노출 | ClusterIP, Ingress는 프론트만 | 인증 없는 API 노출 차단 |
| DB, 벡터 저장소, 실행기 없음 | PostgreSQL, PVC, runner | 요구사항 |
| SSE 설정 없음 | 버퍼링 끔, 읽기 제한 3600초 | UI-03 |
| 쿠버네티스 파일 없음 (`infra-Kubernetes` 브랜치도 동일) | `infra/k8s` | 사용자 결정 |

## 다른 브랜치에서 참고할 것

| 브랜치 | 내용 | 참고 지점 |
|---|---|---|
| `ops-test`의 `playwright-test` | Node + Playwright 실행 데모, SSE 이벤트 | 단계별 스크린샷 전달, 임시 디렉터리 실행. 임의 코드 실행 경고는 ADR-005의 근거 |
| `rag-test`의 `qa-agent-poc` | sqlite-vec RAG, 평가 스크립트, Ollama | 인덱싱과 검색, 정답 데이터 기반 평가 방식 |
| `ops-test`, `feature/agenttest`의 `agent` | Python 파이프라인. 시나리오 → TestQuery(OpenAI 구조화 출력) → 코드 가드(카탈로그, OpenAPI, 단언 1개 이상) → **Python Playwright 인터프리터**(`runner.py`, 코드를 실행하지 않고 TestQuery를 해석). 표시용 `.spec.js`는 따로 렌더링 | TestQuery 형태(`ui`/`api` 묶음, `observe`/`invoke`), 가드 규칙. API는 `observe`만 구현됨 |

동작이 검증된 코드라는 보장은 없다. 구조를 참고하되 계약에 맞춰 새로 작성한다.
