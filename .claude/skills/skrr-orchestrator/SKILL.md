---
name: skrr-orchestrator
description: "SKRR(AI 통합 테스트 자동화 플랫폼)의 프론트, 백엔드, AI, 인프라 개발을 조율하는 오케스트레이터. 이 저장소에서 기능 구현, 화면 개발, API 개발, RAG·시나리오 생성, Playwright 실행, 쿠버네티스 배포, 통합 검증, WBS 작업 진행을 요청하면 반드시 이 스킬을 사용할 것. 후속 작업: 다시 실행, 재실행, 업데이트, 수정, 보완, 특정 영역만 다시, 이전 결과 기반으로 개선, QA 실패 항목 수정 요청에도 사용. 하네스 자체의 구성·점검은 harness 스킬을, 코드에 대한 단순 질문은 직접 답변을 쓴다."
---

# SKRR Orchestrator

요청을 영역별 작업으로 나누고, 계약을 먼저 맞춘 뒤 구현과 검증을 조율한다.

## 실행 모드: 하이브리드

| Phase | 모드 | 이유 |
|---|---|---|
| 1 범위 판별 | 리더 직접 | 비용 없이 경로 결정 |
| 2 계약 | 서브 에이전트 1명 | 단독 작업, 결과를 사용자가 승인 |
| 3 구현 | 에이전트 팀 | 구현자끼리 연동 정보를 직접 교환 |
| 4 점진 검증 | 팀에 합류 | 실패를 담당자에게 바로 전달 |
| 5 통합 검증 | 서브 에이전트 1명 | 구현과 독립적으로 판정 |

### 이 환경의 팀 구성 방법

`TeamCreate`와 `TaskCreate`를 쓸 수 없는 환경이면 다음으로 대체한다.

- 팀원 시작: `Agent`에 `name`, `subagent_type`, `model: "opus"`, `run_in_background: true`를 지정한다.
- 팀원 통신: `SendMessage`. 메시지는 이름으로 보내고, 평문 출력은 다른 팀원에게 보이지 않는다.
- 작업 목록: `_workspace/board.md`를 공유 작업 판으로 쓴다. 각자 자기 행의 상태만 고쳐 충돌을 피한다.

새로 만든 에이전트가 `subagent_type` 목록에 없으면(세션을 다시 시작하기 전 등), `general-purpose`로 시작하고 프롬프트 첫 줄에 `.claude/agents/{name}.md`를 읽고 그 역할로 일하라고 지시한다.

## 에이전트 구성

| 팀원 | 역할 | 스킬 | 소유 경로 | 보고 파일 |
|---|---|---|---|---|
| `contract-architect` | ERD, API, 이벤트, 기술 결정 | `skrr-contracts` | `docs/**` | `_workspace/02_contract-architect_changes.md` |
| `frontend-engineer` | React + TypeScript 화면 | `skrr-frontend` | `frontend/**` | `_workspace/03_frontend-engineer_report.md` |
| `backend-engineer` | Spring Boot API, 실행 제어 | `skrr-backend` | `backend/**` | `_workspace/03_backend-engineer_report.md` |
| `ai-engineer` | RAG, 생성, 가드, 분석, 실행기 | `skrr-ai-pipeline` | `ai/**`, `runner/**` | `_workspace/03_ai-engineer_report.md` |
| `infra-engineer` | Docker, Kubernetes | `skrr-infra` | `infra/**`, `Dockerfile` | `_workspace/03_infra-engineer_report.md` |
| `qa-inspector` | 경계 교차 검증 | `skrr-integration-qa` | `_workspace/04_*` | `_workspace/04_qa-inspector_{범위}.md` |

소유 경로 밖의 파일은 담당자에게 요청한다. 같은 파일을 두 명이 고치는 충돌을 막기 위해서다.

## 워크플로우

### Phase 0: 컨텍스트 확인

1. `harness/context/project.md`를 읽는다.
2. `_workspace/` 존재 여부로 실행 방식을 정한다.
   - 없음 → 초기 실행
   - 있음 + 부분 수정 요청 → 부분 재실행. 해당 에이전트만 호출하고 이전 보고 경로를 프롬프트에 넣는다
   - 있음 + 새 작업 → `_workspace/`를 `_workspace_{YYYYMMDD_HHMMSS}/`로 옮기고 새로 시작한다

### Phase 1: 범위 판별

1. 요청을 요구사항 ID와 WBS 작업에 대응시키고 `_workspace/00_input/request.md`에 적는다. 대응되는 항목이 없거나 제외 범위에 걸리면 사용자에게 먼저 알린다.
2. 영역에 맞춰 경로를 고른다. **필요한 에이전트만 호출한다.** 팀 비용을 줄이고 조율 지연을 피하기 위해서다.

| 요청 유형 | 경로 |
|---|---|
| 한 영역 내부 수정, 계약 변경 없음 | 직접 처리하거나 담당 1명 → 필요하면 QA |
| 한 영역 기능, 계약 그대로 | 담당 1명 + `qa-inspector` |
| 계약 변경이 필요한 기능 | `contract-architect` → 담당자들 + `qa-inspector` |
| 여러 영역에 걸친 기능 (예: 문서 등록 전체) | 전체 Phase |

3. 작업 판을 만든다.

```markdown
| ID | 작업 | 담당 | 의존 | 상태 | 근거 |
|---|---|---|---|---|---|
| T1 | ... | backend-engineer | - | 대기 | FR-01, WBS 4.3.2 |
```

상태는 `대기 → 진행 → 검증 대기 → 완료 | 실패 | 보류`다. 팀원당 4~6개가 적당하다.

### Phase 2: 계약

**실행 모드:** 서브 에이전트. 계약 변경이 없으면 건너뛴다.

1. `contract-architect`를 호출한다 (`model: "opus"`).
2. `docs/contracts/` 변경 후 `check_contracts.py`가 통과하는지 확인한다.
3. **사용자 승인 지점:** 호환성을 깨는 변경이나 미정 항목 결정은 구현 전에 사용자에게 묻는다. 이미 구현된 계약을 바꾸면 여러 서비스를 다시 고쳐야 하기 때문이다.

### Phase 3: 구현

**실행 모드:** 에이전트 팀. 의존 없는 작업은 병렬로 시작한다.

각 팀원의 프롬프트에 작업 ID, 근거(요구사항, WBS, UI 화면), 관련 계약 파일, 보고 경로를 넣는다. 일반적인 순서는 다음과 같다.

```text
infra(기반) ─┐
backend ─────┼→ 계약 기반 병렬 구현 → 연동
ai/runner ───┤
frontend ────┘ (MSW로 먼저 개발 → 실제 API로 교체)
```

통신 규칙:

- 계약 변경이 필요하면 구현을 멈추지 말고 해당 부분만 보류한 채 `contract-architect`에게 요청한다.
- 내부 API가 준비되면 소비자에게 알린다 (`ai-engineer` → `backend-engineer` → `frontend-engineer`).
- 환경변수, 포트, 시스템 의존성이 바뀌면 `infra-engineer`에게 알린다.

### Phase 4: 점진 검증

**실행 모드:** 팀에 합류. 모듈이 끝날 때마다 실행한다. 전체 완성 후 한 번만 검증하면 초기 불일치가 다음 작업으로 번지기 때문이다.

`qa-inspector`가 해당 경계를 검증하고 담당자에게 직접 수정을 요청한다. 같은 항목은 **최대 2회** 수정 루프를 돌고, 그래도 실패하면 리더가 사용자에게 올린다.

### Phase 5: 통합 검증

**실행 모드:** 서브 에이전트. 여러 영역 기능을 마무리할 때 실행한다.

`qa-inspector`를 새로 호출해 흐름 전체를 검증한다. `_workspace/05_qa-inspector_integration.md`에 저장한다.

### Phase 6: 정리

1. 보고 파일을 읽어 사용자에게 요약한다: 한 일, 실행한 검증과 결과, 미검증 항목, 사용자가 정할 일, 관련 WBS 작업과 갱신할 진행 상태.
2. `_workspace/`는 지우지 않는다. 사후 확인에 쓴다.
3. 커밋과 푸시는 사용자가 요청할 때만 한다.
4. 개선할 점이 있는지 묻는다. 에이전트나 스킬을 바꾸면 `CLAUDE.md` 변경 이력에 기록한다.

## 데이터 흐름

```text
request.md → [contract-architect] → docs/contracts/
                                        ↓ (모두 읽음)
        [frontend] [backend] [ai] [infra] ←SendMessage→ 서로
             ↓         ↓       ↓     ↓
                   03_*_report.md + 코드
                        ↓
                 [qa-inspector] → 04_*.md → 실패 시 담당자에게
                        ↓
                 05_*_integration.md → [리더] → 사용자 보고
```

## 에러 핸들링

| 상황 | 전략 |
|---|---|
| 팀원 1명 실패 | 1회 재시작. 재실패 시 작업을 `보류`로 두고 보고에 명시 |
| 계약 충돌 | ADR-012 우선순위 적용. 판단이 갈리면 양쪽을 병기해 사용자에게 질문 |
| 수정 루프 2회 초과 | 멈추고 원인과 함께 사용자에게 보고 |
| 도구 부족 (`kind`, Docker 미실행 등) | 임의 설치 없이 가능한 검증만 하고 미검증 표시 |
| LLM 제공자 미정 | 가짜 클라이언트로 진행, 실제 모델 평가는 미검증 표시 |
| 외부에 영향을 주는 작업 (원격 클러스터 적용, 이미지 푸시, 클라우드 리소스) | 실행 전에 사용자 승인 |

## 테스트 시나리오

### 정상 흐름

"문서 등록 기능 만들어줘" → FR-01, WBS 4.3.2·4.5.1·4.5.2, UI-01로 대응 → 계약이 이미 있어 Phase 2 생략 → `frontend-engineer`, `backend-engineer`, `ai-engineer`, `qa-inspector` 호출 → 필수 문서 누락 시 409와 빠진 항목 표시를 양쪽에서 검증 → 요약 보고.

### 에러 흐름

`qa-inspector`가 `getKnowledgeBase` 응답의 `missingDocumentTypes`를 화면이 읽지 않는 것을 발견 → 양쪽 담당자에게 파일:라인 전달 → 2회 수정 후에도 실패 → 리더가 멈추고 사용자에게 원인을 보고, 나머지 결과는 보고서에 분리 기재.

### 부분 재실행

"리포트 화면만 다시" → `_workspace/` 존재 확인 → `frontend-engineer`만 호출하며 이전 보고와 QA 리포트 경로 전달 → 해당 경계만 재검증.

## 검증 스크립트

- 계약 대조: `python3 .claude/skills/skrr-integration-qa/scripts/check_contracts.py`
- 하네스 구조: `python3 .claude/skills/skrr-orchestrator/scripts/validate_harness.py`
