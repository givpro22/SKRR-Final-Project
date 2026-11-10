# 테스트 대상 사이트 계약

플랫폼이 대상 사이트(목업 쇼핑몰)에 요구하는 조건이다. 대상 사이트는 플랫폼과 별도로 배포하고 URL로만 연결한다 (WBS 4.2.3).

## 플랫폼이 받는 문서 3종 (필수)

| 문서 | 필수 내용 |
|---|---|
| 요구사항 명세서 (PDF, DOCX) | 요구사항마다 `FR-xx` 형식의 ID. UI 예시는 `FR-CART-01`, `FR-ORD-01`, `FR-CPN-02` |
| API 명세서 (OpenAPI YAML, JSON) | 업무 API와 읽기 전용 조회 API. 엔드포인트, 인증 방식, 상태 코드별 응답 스키마 |
| 카탈로그 (CSV, JSON) | 화면 요소와 `data-testid` 대응. 가드가 이 목록으로 존재 여부를 검사한다 |

플랫폼 요구사항 ID(`FR-01`~`FR-07`, `NFR-01`)와 대상 사이트 요구사항 ID(`FR-CART-*` 등)는 다른 체계다.

응답 스키마는 응답 구조 검사의 기준이다. 명세에 없는 작업은 검사하지 않고 `NOT_CHECKED`로 표시하며, 명세가 실제 API와 다르면 정상 시스템도 실패로 나온다. 평가 전에 명세와 실제 응답이 맞는지 확인한다. WBS 4.2.2처럼 텍스트로만 쓴 명세는 이 검사를 할 수 없다.

토큰 방식과 쿠키 방식 로그인을 모두 지원한다. 쿠키는 브라우저 컨텍스트가 자동으로 보내고, 토큰은 로그인 응답에서 캡처해 `Authorization` 헤더로 보낸다.

선택 문서: 테스트 데이터 (`seed_accounts.json` 형태).

```json
{
  "variables": { "memberEmail": "member@example.test" },
  "secrets": { "memberPassword": "..." }
}
```

`variables`는 TestQuery의 `variables`로, `secrets`는 실행기의 `secretVariables`로 넘긴다. 백엔드가 값을 채우고 AI 서버에는 이름만 보낸다. 비밀값이 LLM으로 흘러가지 않게 하기 위해서다.

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
| DB 확인 조회 | `GET {queryApiBaseUrl}/...` | 읽기 전용. DB 직접 접속은 하지 않는다 (요구사항서 제약조건). `X-Test-Control-Token` 헤더로 보호 |
| 데이터 초기화 | `POST {testControlUrl}/reset` `{"seed":"default"}` | 테스트 환경 전용. 공유 토큰 헤더 `X-Test-Control-Token` 필수 |
| 장애 주입 | `POST {testControlUrl}/faults` `{"faultId":"..."}`, `DELETE {testControlUrl}/faults` | 성공 기준 평가용 (심은 장애 탐지율 80%, 오탐 5% 이하) |
| 빌드 식별자 | `GET {testControlUrl}/version` → `{"build":"a3f9c21"}` | UI-04 "빌드 a3f9c21" 표시용. 없으면 표시 생략 |

테스트 전용 API는 `/api/test/*` 아래에 두기를 권한다 (`testControlUrl` = `{대상 URL}/api/test`). 팀의 경쟁 분석 문서가 이 격리를 차별점으로 든 경로다. 운영 배포에서는 이 경로를 끈다.

"DB는 읽기 전용으로만 확인한다"는 제약과 "실행마다 데이터를 복원한다"(WBS 4.2.3, 4.3.8)는 요구가 충돌하지 않도록, 검증과 초기화의 경로를 나눴다. 조회 API는 쓰기 기능을 갖지 않고, 초기화는 테스트 전용 API로만 한다.

## 허용 범위

실제 운영 시스템과 외부 상용 서비스는 대상이 아니다 (요구사항서 제외 범위). 실행기는 `RUNNER_ALLOWED_TARGET_HOSTS`에 등록한 호스트에만 접속한다.
