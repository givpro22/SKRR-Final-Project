---
name: skrr-frontend
description: "SKRR 플랫폼 화면을 React + TypeScript로 구현·수정한다. 문서 등록, 테스트 요청, 시나리오 승인, 실행 모니터, 결과 리포트 화면, 모달, 사이드바, SSE 실시간 로그, API 연동, 디자인 토큰, frontend 폴더 작업을 요청하면 반드시 이 스킬을 사용할 것. 대상 쇼핑몰 화면이나 백엔드 API 구현에는 쓰지 않는다."
---

# 프론트엔드 구현

## 시작 전에

1. `harness/context/ui-screens.md`에서 화면 명세, 토큰, 사용 API를 확인한다.
2. **`harness/references/export/`의 해당 PNG를 직접 연다.** 요약에 없는 간격, 정렬, 강조가 캡처에 있다.
3. `docs/contracts/platform-api.openapi.yaml`을 확인한다. 실행 모니터는 `docs/contracts/events.md`와 `docs/contracts/state-machines.md`도 읽는다.

## 스택

Vite, React 18, TypeScript(strict), Tailwind CSS(확정), React Router, TanStack Query, openapi-typescript + openapi-fetch, MSW, clsx, lucide-react, Vitest + Testing Library. 추가 라이브러리는 이유가 있을 때만 넣고 `docs/decisions.md`에 올린다.

## 폴더 구조

```text
frontend/src/
  api/         schema.d.ts(생성물), client.ts, queries/{영역}.ts
  app/         라우터, 앱 레이아웃, 사이드바
  components/  Badge, Button, Modal, ProgressBar 등 공용
  features/
    documents/  UI-01
    requests/   테스트 요청 목록, UI-02-1, UI-02-1B, 완료 모달
    scenarios/  UI-02-5
    runs/       UI-03, useRunEvents.ts
    reports/    UI-04
  mocks/       MSW 핸들러 (계약 예시 응답)
  styles/      app.css (Tailwind 불러오기, @theme 토큰)
```

## 스타일 (Tailwind CSS)

설치 시 공식 문서의 Vite 안내를 따른다 (`@tailwindcss/vite` 플러그인, v4 기준). 토큰은 `harness/context/ui-screens.md`의 테마 변수 표를 `app.css`에 그대로 옮긴다.

```css
@import "tailwindcss";

@theme {
  --color-page: #F6F6F3;
  --color-ink: #14161B;
  /* 나머지는 ui-screens.md의 표 전체 */
  --radius-card: 16px;
}
```

- 색은 테마 유틸리티로 쓴다 (`bg-page`, `text-danger`). `bg-[#F6F6F3]` 같은 임의 값이나 기본 팔레트(`bg-blue-500`)는 쓰지 않는다. 캡처 색과 어긋나고 토큰을 한곳에서 고칠 수 없게 되기 때문이다.
- 클래스 이름을 문자열로 조합하지 않는다. `` `bg-${tone}-soft` ``는 Tailwind가 소스에서 찾지 못해 CSS가 생성되지 않는다. 상태별로 완성된 클래스 전체를 객체에 매핑한다.

```ts
const scenarioBadge: Record<ScenarioStatus, string> = {
  APPROVED: "bg-success-soft text-success",
  GUARD_RETRY: "bg-danger-soft text-danger",
  // 모든 상태를 채워 타입 검사로 누락을 잡는다
};
```

- 반복되는 조합은 `@apply`보다 React 컴포넌트(`Badge`, `Button`)로 묶는다. 조건부 클래스는 `clsx`로 합친다.
- 기준 폭은 캡처의 1440px이다. 다른 폭의 동작은 캡처에 없으므로 임의로 설계했다면 보고에 적는다.

## API 호출

타입을 손으로 쓰지 않고 생성한다. 명세와 어긋나도 컴파일이 통과하는 일을 막기 위해서다.

```bash
npx openapi-typescript ../docs/contracts/platform-api.openapi.yaml -o src/api/schema.d.ts
```

- 기본 경로는 `/api/v1`이다. 브라우저는 백엔드 외의 서비스를 호출하지 않는다.
- `as` 단언과 `any`로 응답 타입을 우회하지 않는다.
- 생성 중 상태(`REFINING`, `GENERATING`, 인덱싱)는 2초 간격으로 조회하고, 끝나면 멈춘다.
- 오류는 `Problem.code`로 분기한다. `MISSING_REQUIRED_DOCUMENTS`는 UI-01 배너, `fieldErrors`는 입력 옆에 표시한다.

## 화면 규칙

- 화면이 받는 값은 계약 enum으로 다루고, 표시 문구는 `ui-screens.md`의 상태 문구 표에서 한곳에 모은다.
- 표시 코드(`SC-01`)와 내부 ID를 섞지 않는다. 경로에는 UUID를 쓴다.
- 캡처의 예시 값을 코드에 넣지 않는다.
- 모든 데이터 영역에 로딩, 오류, 빈 상태를 만든다. 캡처에는 대부분 정상 상태만 있으므로 토큰을 맞춰 설계하고 보고에 적는다.

## 흐름별 주의점

**UI-01:** `canBuild`가 거짓이면 `지식 베이스 구축`을 비활성화하고, `missingDocumentTypes`로 배너와 강조 행을 만든다. 파일 크기와 형식은 업로드 전에 먼저 검사하되, 서버의 413 응답도 처리한다.

**UI-02 모달:** 입력 → 후보 대기 → 선택 또는 직접 입력 → 생성 대기 → 완료 순서다. 모달을 닫아도 요청은 서버에서 계속 진행되므로, 다시 열었을 때 `getTestRequest`로 이어서 표시한다.

**UI-02-5:** `APPROVED` 시나리오만 체크할 수 있다. 케이스 상세에서 `expectedValues`를 보여 주고 고칠 수 있게 한다. 사용자가 승인하는 값이므로 `consistencyOnly` 항목은 이유와 함께 눈에 띄게 표시한다. 수정하면 승인이 풀리므로 저장 후 목록을 다시 읽는다. 가드 문구는 `guard.message`와 `guard.attempt`로 표시한다.

**UI-03:** `getRun` 스냅샷을 그린 뒤 `EventSource`를 `?afterSeq={lastEventSeq}`로 연다. `EventSource`는 첫 요청에 헤더를 넣을 수 없다.

- 이벤트 `seq`를 기억해 중복을 무시한다.
- 재연결에는 브라우저 기본 동작을 쓰고, 끊긴 상태를 화면에 표시한다.
- 끝난 상태의 `run.status`를 받으면 연결을 닫는다. 닫지 않으면 무한 재연결한다.
- 로그는 최근 1000줄만 렌더링한다. 나머지는 `listRunLogs`로 읽는다.

**UI-04:** 실행이 끝나기 전의 409 `RUN_NOT_FINISHED`면 실행 모니터로 안내한다. 이전 실행 대비 비교는 구현하고, `PDF 내보내기` 버튼은 캡처에 있어도 표시하지 않는다 (ADR-013). 동작하지 않는 버튼을 남기지 않기 위해서다. 로그인 화면도 만들지 않으며, 사이드바 사용자는 `getCurrentUser` 값을 표시한다.

## 테스트

| 대상 | 방법 |
|---|---|
| 상태 → 문구·색 대응 | 단위 테스트 |
| UI-01 필수 문서 누락, UI-02 흐름, 승인 해제 | Testing Library + MSW |
| SSE 재연결, 중복 이벤트 | `useRunEvents` 단위 테스트 |
| 화면 일치 | 실행 후 스크린샷을 캡처 PNG와 나란히 비교 |

## 완료 전 검증

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

화면은 실제로 띄워 1440px에서 캡처와 비교하고, 콘솔 오류를 확인한다. 브라우저를 열지 못했다면 화면 일치는 미검증으로 보고한다. `Dockerfile`이나 `nginx.conf`가 필요하면 `infra-engineer`에게 요청한다.
