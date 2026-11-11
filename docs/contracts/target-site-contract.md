# 테스트 대상 사이트 계약

플랫폼이 대상 사이트(목업 쇼핑몰)에 요구하는 조건이다. 대상 사이트는 플랫폼과 별도로 배포하고 URL로만 연결한다 (WBS 4.2.3).

## 플랫폼이 받는 문서 3종 (필수)

| 문서 | 필수 내용 |
|---|---|
| 요구사항 명세서 (PDF, DOCX) | 요구사항마다 `FR-xx` 형식의 ID. UI 예시는 `FR-CART-01`, `FR-ORD-01`, `FR-CPN-02` |
| API 명세서 (OpenAPI YAML, JSON) | 업무 API와 읽기 전용 조회 API. 엔드포인트, 인증 방식, 상태 코드별 응답 스키마 |
| 카탈로그 (CSV, JSON) | 화면 요소와 `data-testid` 대응. 가드가 이 목록으로 존재 여부를 검사한다 |

플랫폼 요구사항 ID(`FR-01`~`FR-07`, `NFR-01`)와 대상 사이트 요구사항 ID(`FR-CART-*` 등)는 다른 체계다.

### 문서 형식

업로드(`uploadDocument`)는 확장자로 형식을 검사한다. 다르면 `400 UNSUPPORTED_FILE_TYPE`과 `allowedExtensions`를 돌려준다. 파일당 20MB 이하, 빈 파일은 거부한다.

| 문서 종류 | type | 허용 확장자 | 필수 |
|---|---|---|---|
| 요구사항 명세서 | `REQUIREMENT` | `pdf`, `docx` | 예 |
| API 명세서 | `API_SPEC` | `yaml`, `yml`, `json` | 예 |
| 카탈로그 | `CATALOG` | `csv`, `json` | 예 |
| 테스트 데이터 | `TEST_DATA` | `json` | 아니요 |

응답 스키마는 응답 구조 검사의 기준이다. 명세에 없는 작업은 검사하지 않고 `NOT_CHECKED`로 표시하며, 명세가 실제 API와 다르면 정상 시스템도 실패로 나온다. 평가 전에 명세와 실제 응답이 맞는지 확인한다. WBS 4.2.2처럼 텍스트로만 쓴 명세는 이 검사를 할 수 없다.

토큰 방식과 쿠키 방식 로그인을 모두 지원한다. 쿠키는 브라우저 컨텍스트가 자동으로 보내고, 토큰은 로그인 응답에서 캡처해 `Authorization` 헤더로 보낸다.

선택 문서: 테스트 데이터 (`seed_accounts.json` 형태).

```json
{
  "variables": { "memberEmail": "member@example.test" },
  "secrets": { "memberPassword": "..." }
}
```

`variables`는 TestQuery의 `variables`로, `secrets`는 실행기의 `secretVariables`로 넘긴다. 백엔드가 값을 채우고 AI 서버에는 이름만 보낸다. 비밀값이 LLM으로 흘러가지 않게 하기 위해서다. 값은 저장된 TestQuery와 spec에 남기지 않고 실행할 때마다 현재 활성 TEST_DATA에서 채운다. 그래서 TEST_DATA를 바꿔도 지식 베이스나 승인 상태는 바뀌지 않는다 (ADR-020).

### 카탈로그 JSON 형식

```json
{
  "elements": [
    {
      "testId": "cart-add-button",
      "page": "/products/:id",
      "label": "장바구니 담기 버튼",
      "type": "button",
      "requirementRefs": ["FR-CART-01"]
    }
  ]
}
```

CSV는 같은 이름의 열(`requirementRefs`는 `;` 구분)을 쓴다.

## 대상 사이트가 제공할 API

| 용도 | 형태 | 규칙 |
|---|---|---|
| 업무 API | 사이트 자체 API | 테스트 대상 |
| DB 확인 조회 | `GET {queryApiBaseUrl}/...` | 읽기 전용. DB 직접 접속은 하지 않는다 (요구사항서 제약조건). `X-Test-Control-Token` 헤더로 보호. TestQuery `dbChecks[].path`는 `queryApiBaseUrl`의 출처 기준 전체 경로이고 그 경로로 시작해야 한다 (예: `/api/test/query/cart-items`) |
| 데이터 초기화 | `POST {testControlUrl}/reset` `{"seed":"default"}` | 테스트 환경 전용. 공유 토큰 헤더 `X-Test-Control-Token` 필수. 케이스마다 SETUP과 TEARDOWN(정리)에서 두 번 부르므로 여러 번 불러도 같은 결과여야 한다. **데이터만 초기 상태로 되돌리고 활성 장애는 지우지 않는다** (아래 "초기화와 장애 주입") |
| 장애 주입 | `POST {testControlUrl}/faults` `{"faultId":"..."}`, `DELETE {testControlUrl}/faults` | 성공 기준 평가용 (심은 장애 탐지율 80%, 오탐 5% 이하). 주입한 장애는 `DELETE /faults`를 부를 때까지 유지된다. 같은 토큰 헤더 필수 |
| 빌드 식별자 | `GET {testControlUrl}/version` → `{"build":"a3f9c21"}` | UI-04 "빌드 a3f9c21" 표시용. 없으면 표시 생략 |

테스트 전용 API는 `/api/test/*` 아래에 두기를 권한다 (`testControlUrl` = `{대상 URL}/api/test`). 팀의 경쟁 분석 문서가 이 격리를 차별점으로 든 경로다. 운영 배포에서는 이 경로를 끈다.

"DB는 읽기 전용으로만 확인한다"는 제약과 "실행마다 데이터를 복원한다"(WBS 4.2.3, 4.3.8)는 요구가 충돌하지 않도록, 검증과 초기화의 경로를 나눴다. 조회 API는 쓰기 기능을 갖지 않고, 초기화는 테스트 전용 API로만 한다.

## 초기화와 장애 주입 (테스트 사이트 구현 필수 규칙)

> **`POST /reset`은 데이터만 되돌린다. 활성 장애는 `DELETE /faults`로만 해제된다.**

플랫폼은 케이스마다 SETUP과 TEARDOWN에서 `reset`을 부른다. `reset`이 장애까지 지우면 실행 전에 심은 장애가 첫 케이스에서 사라져 성공 기준(심은 장애 80% 탐지)을 플랫폼 실행으로 잴 수 없다. 그래서 두 상태를 나눈다 (리더 결정, 2026-11-10, ADR-022).

| 상태 | 바꾸는 API | `reset`의 영향 |
|---|---|---|
| 업무 데이터 (회원, 상품, 장바구니, 주문 등) | `POST /reset` | 초기 seed로 되돌림 |
| 활성 장애 목록 | `POST /faults`(추가), `DELETE /faults`(전부 해제) | 바꾸지 않음 |

성공 기준 측정 절차: `POST /faults`로 장애 주입 → 플랫폼에서 실행(케이스마다 `reset`해도 장애 유지) → 실행이 끝나면 `DELETE /faults`로 해제 → 다음 장애. 오탐 측정은 활성 장애가 없는 상태에서 같은 실행을 한다.

## 허용 범위

실제 운영 시스템과 외부 상용 서비스는 대상이 아니다 (요구사항서 제외 범위). 실행기는 `RUNNER_ALLOWED_TARGET_HOSTS`에 등록한 호스트에만 접속한다.

## 연결 확인 (UI-01 "연결 확인")

`verifyTargetSite` → 실행기 `checkTargetConnectivity`가 대상 URL에 HTTP GET을 한 번 보낸다. 브라우저를 띄우지 않으며 리다이렉트는 따라가지 않는다 (ADR-019). 이 확인은 "서버가 살아 있고 실행기가 닿는다"까지만 보장하고, 화면 조작 가능 여부는 실제 실행에서 드러난다.

| 결과 | 판정 | 상태 코드 저장 |
|---|---|---|
| 2xx, 3xx 응답 | `REACHABLE` | 응답 코드 |
| 4xx 응답 (예: Basic Auth 401, 첫 화면 404) | `REACHABLE` | 응답 코드 |
| 5xx 응답 | `UNREACHABLE` | 응답 코드 |
| 연결 거부, DNS 실패, 시간 초과(`CONNECTIVITY_TIMEOUT_MS`, 기본 10초) | `UNREACHABLE` | 없음 |
| 허용 목록 밖, http(s)가 아닌 주소, URL에 계정 정보 | `UNREACHABLE` | 없음 |
| 실행기 자체에 연결할 수 없음 | 판정 안 함. `503 DEPENDENCY_UNAVAILABLE`, 프로젝트 상태 유지 | - |

4xx를 도달 가능으로 보는 이유는 서버가 응답했다는 사실이 연결 확인의 목적이기 때문이다. 대상 사이트가 인증을 요구하는 것은 접속 실패가 아니다. 결과 상태, 상태 코드, 판정 문장은 프로젝트에 저장해 새로고침해도 보인다.
