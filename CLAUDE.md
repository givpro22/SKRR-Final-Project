# SKRR Final Project

AI 기반 통합 테스트 자동화 및 오류 분석 시스템. 프로젝트 사실은 `harness/context/project.md`, 구조는 `docs/architecture.md`, 결정은 `docs/decisions.md`에 있다.

## 하네스: SKRR 플랫폼 개발

**목표:** 프론트, 백엔드, AI, 인프라를 하나의 계약(`docs/contracts/`)과 화면 기준(`harness/references/export/`)에 맞춰 개발하고 검증한다.

**트리거:** 이 저장소의 기능 구현, 화면·API·AI·배포 작업, 통합 검증, 그 결과의 수정과 재실행을 요청받으면 `skrr-orchestrator` 스킬을 사용하라. 단순 질문은 직접 답한다. 하네스 자체의 구성과 점검은 `harness:harness` 스킬을 쓴다.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-11-09 | 초기 구성, ERD·API 명세 초안 작성 | 전체 | 사용자 요청. ERD와 API 명세가 없어 함께 작성 |
| 2026-11-09 | 스타일 방식을 CSS Modules에서 Tailwind CSS로 변경 | skills/skrr-frontend, agents/frontend-engineer, harness/context, docs/decisions.md | 사용자 결정 |
| 2026-11-09 | 실행기를 별도 Node 서버로 확정 | harness/context, docs/decisions.md | 사용자 결정 |
| 2026-11-09 | MVP 범위 확정: 로그인 없음, GitHub 입력 제외, PDF는 MVP 이후, 실행 비교 포함 | skills/skrr-frontend, skills/skrr-backend, harness/context, docs | 사용자 결정 |
| 2026-11-09 | 코드 저장소를 이 저장소로 확정 | harness/context, docs/decisions.md | 사용자 결정 |
| 2026-11-09 | API 검사 강화: 인증 헤더, 응답 구조 검사, 기대값 필수 | docs/contracts, skills/skrr-ai-pipeline, skills/skrr-backend, skills/skrr-integration-qa, harness/context | 사용자 요청. 토큰 방식 테스트 불가 등 빈틈 발견 |
