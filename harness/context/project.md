# SKRR 프로젝트 컨텍스트

모든 에이전트가 작업 전에 읽는 공통 사실이다. 원본은 `harness/references/`에 있으며, 내용이 어긋나면 `docs/decisions.md` ADR-012의 우선순위를 따른다.

## 프로젝트

- 팀 SKRR, **AI 기반 통합 테스트 자동화 및 오류 분석 시스템**, 2026-10-26 ~ 2026-12-10
- 사용자: QA 담당자. 자연어로 요청하고 AI가 만든 시나리오를 승인하며, 결과를 함께 살펴본다.
- 흐름: 자연어 요청 → 명세 기반 시나리오 → 사용자 승인 → Playwright 실행 → 화면·API·DB 교차 검증 → 원인과 해결 방안이 담긴 리포트

## 원본 자료

| 파일 (`harness/references/`) | 무엇을 볼 때 |
|---|---|
| `프로젝트정의요구사항서_템플릿.pdf` | 범위, 제외 범위, 요구사항(FR-01~07, NFR-01), 수용기준, 성공 기준. 요구사항 표는 6쪽 |
| `WBS_공통_프로젝트_템플릿.pdf` | 작업 분해, 완료 기준. 글자가 작으므로 `pdftotext -layout`으로 읽는다 |
| `image (3).png` | AI 파이프라인 |
| `image (4).png` | 시스템 구조, 포트, S3 폴더 |
| `export/UI-*.png` | 화면 7장. 요약은 `harness/context/ui-screens.md` |

## 범위

**포함:** 목업 쇼핑몰 구축·배포(DB 조회 API, 장애 주입 포함), 명세 기반 RAG와 AI 파이프라인(생성→승인→코드화→실행→분석→리포트), 플랫폼 웹 화면, 장애 주입 기반 품질 평가.

**제외:** 실제 운영 시스템과 외부 상용 서비스 대상 테스트, Vision AI 레이아웃 검사, 제품 기능으로서의 CI/CD 연동, 코드 자동 수정, 성능·부하·보안 테스트, 모바일·다중 브라우저 호환성 검사.

**제약:** 실제 데이터가 없어 명세서·카탈로그·장애 목록·평가 요청을 팀이 직접 만든다. LLM API 지연과 오류에 대비해 재시도를 둔다. 대상 DB는 읽기 전용 조회 API로만 확인한다.

## 성공 기준

- 자연어 요청 한 줄로 시나리오부터 리포트까지 완주 (10건 중 8건 이상)
- 심은 장애의 80% 이상 탐지, 정상 시스템 오탐 5% 이하
- 탐지한 장애의 70% 이상에서 실제 원인을 1순위로 제시

## 팀 역할

| 이름 | 역할 | 담당 |
|---|---|---|
| 정회중 | PM, Infra | 프로젝트 관리, 쿠버네티스·도커 환경 |
| 박영서 | Front-End | 와이어프레임, **API 명세서**, 서비스 페이지 |
| 이다영 | AI | RAG 기반 자연어 입력 수정, 테스트 사이트 |
| 최강희 | AI | 시나리오, Playwright 코드 생성 Agent |
| 황민채 | BackEnd | **ERD**, Front-Server, S3, AI 서버 API 연동 |

계약 초안은 하네스가 만들지만, 확정은 위 담당자가 한다.

## 도메인별 WBS 작업

| 도메인 | 에이전트 | WBS | 산출물 위치 |
|---|---|---|---|
| 계약 | `contract-architect` | 4.1 (설계 4종 중 ERD, API) | `docs/` |
| 프론트 | `frontend-engineer` | 4.4 | `frontend/` |
| 백엔드 | `backend-engineer` | 4.3, 4.7 집계 | `backend/` |
| AI | `ai-engineer` | 4.5, 4.6, 4.7 분석 | `ai/`, `runner/` |
| 인프라 | `infra-engineer` | 4.2.3 일부, 플랫폼 배포 (WBS 추가 필요) | `infra/`, 각 `Dockerfile` |
| 검증 | `qa-inspector` | 4.8, 5 | `_workspace/` 리포트 |

테스트 대상 사이트(WBS 4.2)는 담당자가 별도로 만들며, 플랫폼은 `docs/contracts/target-site-contract.md`로만 연결한다.

## 확정 사항 (2026-11-09 사용자)

- 작업 영역: 프론트, 백엔드, AI, 인프라
- 프론트 React + TypeScript + Tailwind CSS, 백엔드 Java Spring Boot, AI Python, 인프라 Kubernetes + Docker
- Playwright는 백엔드와 분리된 Node 서버(`runner/`)에서 실행한다
- 코드 저장소는 이 저장소(`givpro22/SKRR-Final-Project`)다. `JHuiJung/SKALA-Final-Project`는 참고용이다
- MVP 범위 (ADR-013): 로그인 화면 없음(Ingress Basic Auth), GitHub 입력과 Clone 제외, 리포트 PDF는 MVP 이후, 이전 실행 대비 비교는 포함
- 플랫폼 ERD와 API 명세가 없어 하네스가 `docs/contracts/`에 초안을 만들었다
- `harness/references/` 자료와 `export` 화면을 구현 기준으로 삼는다

## 아직 미정

| 항목 | 영향 | 그동안의 처리 |
|---|---|---|
| LLM 제공자 (ADR-010) | AI 실제 호출, 평가 | 교체 가능한 인터페이스와 가짜 클라이언트로 개발 |
| 클러스터 종류, 이미지 레지스트리, 도메인 | 실제 배포 | `local` overlay(kind)까지만 진행 |
| 대상 사이트 ERD·API 명세 존재 여부 | RAG 입력 | WBS는 완료로 표시했지만 자료가 폴더에 없음. 받기 전에는 목업 사용 |

## 공통 작업 규칙

- 코드 내 문구와 문서는 한국어, 식별자는 영어로 쓴다.
- 계약(`docs/contracts/`)과 다르게 구현하지 않는다. 바꿔야 하면 `contract-architect`에게 먼저 요청한다.
- 비밀값을 커밋하지 않는다. 이 저장소는 공개 상태다.
- 커밋과 푸시는 사용자가 요청할 때만 한다. 커밋 메시지는 `feat:`, `fix:`, `chore:`, `docs:` 접두사를 쓴다.
- 완료 보고에는 실제로 실행한 검증 명령과 결과를 적고, 실행하지 못한 항목은 "미검증"으로 분리한다.
