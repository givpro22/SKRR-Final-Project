# Playwright 실행기 (`runner/`)

계약: `docs/contracts/runner-api.openapi.yaml`, `docs/contracts/schemas/test-query.schema.json`. 근거: ADR-005, WBS 4.6.1, 4.6.2, 4.6.4, FR-04, FR-05, NFR-01.

## 스택과 구조

Node 22, TypeScript, Fastify, `@playwright/test`, Ajv(TestQuery 검증). Chromium 전용(다중 브라우저는 제외 범위), 기본 1280×800.

```text
runner/src/
  server.ts      API, 동시 실행 1건 제한
  schema.ts      Ajv 검증
  render/        TestQuery → spec.ts, 동작별 변환 함수
  compile.ts     tsc --noEmit
  execute.ts     임시 디렉터리 실행, 이벤트 수집
  artifacts.ts   presigned URL 업로드
  mask.ts        secretVariables 마스킹
```

## 변환 규칙

변환기는 입력이 같으면 항상 같은 코드를 만든다.

| 동작 | 생성 코드 |
|---|---|
| `goto` | `await page.goto(path)` (`baseURL` 기준) |
| `click`, `fill`, `selectOption` | `page.getByTestId(testId).click()` 등 |
| `expectVisible`, `expectText`, `expectCount` | `await expect(...)` |
| `captureText` | `captures[as] = await ...textContent()` |
| `waitForApi` | `page.waitForResponse`를 등록하고 `trigger` 클릭 후 대기, 상태와 구조 검사, JSONPath 캡처 |
| `apiRequest` | `request.fetch(path, { headers, data })`, 상태와 구조 검사, JSONPath 캡처 |
| `expectCapture` | 캡처 값과 비교 |

- 입력 값은 `JSON.stringify`로만 코드에 넣는다. 문자열 이어 붙이기로 넣으면 코드 주입이 가능하다.
- `{{name}}` 치환은 실행 시점에 변수, 비밀 변수, 캡처 값에서 찾는다. `secretVariables`와 `secretCaptures` 값은 spec 소스에 쓰지 않는다.
- 치환 뒤의 경로를 다시 검사한다. 값에 `//host`나 다른 호스트가 들어가 같은 출처를 벗어나면 실패 처리한다. 스키마 검사는 치환 전 값만 보기 때문이다.
- 각 동작을 `test.step(id, ...)`으로 감싸 단계 이벤트와 연결한다.
- `dbChecks`, `crossChecks`는 변환하지 않는다. 백엔드가 처리한다.
- 파일명은 `{testCaseCode 소문자}.spec.ts`다 (`tc-12.spec.ts`).

## 안전

- **받은 코드를 실행하는 API를 만들지 않는다.** 실행은 항상 TestQuery를 변환한 결과로만 한다.
- `baseUrl` 호스트가 `RUNNER_ALLOWED_TARGET_HOSTS`에 없으면 422 `TARGET_NOT_ALLOWED`를 반환한다. 페이지가 이동해도 허용 호스트 밖의 요청은 라우팅 단계에서 막는다.
- 실행마다 새 브라우저 컨텍스트와 임시 디렉터리를 쓰고 끝나면 지운다.
- `timeoutMs`를 넘기면 브라우저를 강제 종료한다. 중단 요청은 10초 안에 처리한다.
- 로그, 단계 값, 응답 본문에 비밀값을 남기지 않는다. 전송 전에 `mask.ts`를 거친다. `secretVariables`, `secretCaptures` 값과 `Authorization`, `Cookie`, `Set-Cookie` 헤더 값은 항상 가린다.
- `Host`, `Content-Length`, `Connection`, `Cookie` 헤더는 대소문자 구분 없이 거부한다.
- HAR은 업로드 전에 인증 헤더 값을 지운다. trace에는 네트워크 내용이 남을 수 있으므로, 대상 사이트에는 테스트 전용 계정만 쓴다.
- AWS와 DB 자격 증명을 받지 않는다.

## 수집과 이벤트

단계가 끝날 때마다 스크린샷을 찍어 presigned URL로 올리고 `screenshot` 이벤트를 보낸다. 영상 스트리밍은 하지 않는다. trace와 HAR은 실행 종료 후 올린다. 업로드 실패는 테스트 판정에 영향을 주지 않으며 결과에 기록한다.

실패 유형은 다음처럼 분류한다.

| 상황 | `failureType` |
|---|---|
| `expect` 실패 | `ASSERTION_FAILED` |
| 요소 찾기 실패 | `ELEMENT_NOT_FOUND` |
| 기대와 다른 HTTP 상태 | `API_ERROR` |
| 응답이 `responseSchema`와 다름 | `API_SCHEMA_MISMATCH` |
| 시간 초과 | `TIMEOUT` |
| 대상 접속 불가, 브라우저 실패 | `ENVIRONMENT_ERROR` |
| 변환 코드 오류 | `TEST_CODE_ERROR` |

`DATA_MISMATCH`는 교차 검증 결과이므로 백엔드가 정한다.

## 응답 구조 검사

`responseSchema`가 있으면 Ajv로 검사하고 단계 결과에 `schemaCheck`와 `schemaErrors`를 넣는다. 없으면 `NOT_CHECKED`다. 스키마 자체를 컴파일할 수 없으면 대상 사이트 결함이 아니므로 `TEST_CODE_ERROR`로 분류한다. `schemaErrors`에는 경로와 기대 타입만 쓰고 응답 값은 넣지 않는다. 비밀값이 섞일 수 있기 때문이다.

## 테스트

- 변환: 동작별 스냅샷, 따옴표·백틱·`${}`가 든 값으로 주입 시도, 모든 결과 `tsc` 통과
- 실행: 작은 로컬 HTML 앱을 띄워 통과, 실패, 시간 초과, 중단
- API: 토큰 캡처 후 헤더 전달, 필드 누락과 타입 변경 탐지, 스키마 없는 단계의 `NOT_CHECKED`
- 안전: 허용 안 된 호스트 거부, 치환 후 경로 이탈 거부, 비밀값이 로그와 spec, HAR에 없는지 검사
- 동시 실행 시 409 `RUNNER_BUSY`

검증: `npm run typecheck && npm run lint && npm test`. 브라우저 설치가 필요하므로 불가능하면 미검증으로 보고한다. 이미지에 넣을 Playwright 버전은 `@playwright/test` 버전과 같아야 하므로 바꾸면 `infra-engineer`에게 알린다.
