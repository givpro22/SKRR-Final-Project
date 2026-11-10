---
name: skrr-ai-pipeline
description: "SKRR의 AI 서버(Python, FastAPI)와 Playwright 실행기를 구현·수정한다. 문서 파싱, 임베딩, sqlite-vec RAG, 자연어 요청 정제, 시나리오·테스트 케이스 생성, 가드 검증, TestQuery 생성, spec 변환, 테스트 실행, 실패 원인 분석, LLM 프롬프트, LangGraph, 평가 지표, ai 또는 runner 폴더 작업을 요청하면 반드시 이 스킬을 사용할 것. 백엔드 실행 제어나 화면 작업에는 쓰지 않는다."
---

# AI 파이프라인과 실행기

실행기(`runner/`) 작업이면 `references/runner.md`를, 평가 작업이면 `references/evaluation.md`를 함께 읽는다.

## 7단계 엔진 루프에서의 위치

이 스킬이 맡는 AI·실행기 작업은 업계 공통 7단계 루프(`docs/architecture.md` "파이프라인 7단계")의 ①②④⑥에 해당한다. 아래 절 번호와 대응한다.

- ① 인식 = §1 지식 베이스, §2 요청 정제
- ② 생성 = §3 시나리오·가드, §4 TestQuery
- ④ 실행 = `references/runner.md`
- ⑥ 분석 = §5 원인 분석

③ 안정화(데이터 초기화·정리)와 ⑦ 보고(플랫폼 UI 집계)는 백엔드가 맡고, 선택자 환각 차단은 ⑤ 치유 대신 §3·§4의 카탈로그 가드가 맡는다(ADR-005). 결과는 TestRail 같은 상용 도구가 아니라 자체 플랫폼 화면(UI-03·UI-04)에 보고한다.

## 시작 전에

`docs/contracts/ai-api.openapi.yaml`, `docs/contracts/schemas/test-query.schema.json`, `docs/contracts/target-site-contract.md`, 그리고 `harness/references/image (3).png`(파이프라인)를 읽는다. 구조 참고 자료는 `harness/context/infra-baseline.md` 마지막 표에 있다.

## 스택

Python 3.12, FastAPI, Pydantic v2, pydantic-settings, LangGraph, sqlite-vec, boto3, httpx, tenacity, pypdf, python-docx, PyYAML, pytest, ruff, mypy. LLM SDK를 고를 때는 공식 문서에서 현재 버전과 모델 이름을 확인한다. 대상이 Claude이면 `claude-api` 스킬을 먼저 읽는다.

## 폴더 구조

```text
ai/app/
  api/         라우터, 작업 저장소
  core/        설정, 로깅
  llm/         client.py(인터페이스), providers/, fake.py
  knowledge/   parsers/, chunking.py, store.py(sqlite-vec), retrieval.py
  pipeline/    refine.py, scenario_graph.py, test_query.py, analysis.py
  guards/      schema.py, catalog.py, spec.py
  prompts/     프롬프트 파일(버전 관리)
ai/evals/      평가 데이터와 스크립트
ai/tests/
```

## LLM 인터페이스

```python
class LLMClient(Protocol):
    async def generate_json(self, *, system: str, user: str, schema: type[BaseModel]) -> BaseModel: ...
    async def embed(self, texts: list[str]) -> list[list[float]]: ...
```

제공자는 `LLM_PROVIDER`로 고른다 (ADR-010 미정). 파이프라인이 특정 SDK를 직접 import하지 않게 해서, 제공자가 정해져도 파이프라인을 고치지 않게 한다. `fake.py`는 정해진 입력에 정해진 출력을 돌려주어 테스트와 개발에 쓴다. 호출에는 60초 시간 제한과 지수 백오프 3회 재시도를 건다 (WBS 4.6.3). 다만 스키마 위반 응답은 재시도 대신 가드 루프로 넘긴다.

## 작업 처리

모든 생성 API는 202와 `jobId`를 반환한다. 작업은 프로세스 메모리에 두며, 재시작하면 사라지고 백엔드가 재요청한다 (ADR-007). `progress.message`는 화면에 그대로 표시되므로 사용자가 읽을 문장으로 쓴다. 업무 DB에는 접근하지 않는다.

## 1. 지식 베이스 (WBS 4.5.1, 4.5.2)

S3에서 내려받아 `checksumSha256`을 확인한 뒤 유형별로 파싱한다.

| 문서 | 청크 단위 | 메타데이터 |
|---|---|---|
| 요구사항 | 요구사항 ID 1개 | `sourceId`(FR-CART-01), 제목 |
| API 명세 | 엔드포인트 1개 | `method path`, 읽기 전용 여부 |
| 카탈로그 | 화면 또는 요소 그룹 | `testId` 목록, 페이지 |

문자 수로 자르지 않는다. ID 단위로 잘라야 근거 인용과 가드 검사가 가능하기 때문이다. ID 형식이 없는 문서는 조용히 넘기지 않고 `DOCUMENT_PARSE_FAILED`와 위치를 돌려준다. 저장은 `{KB_DATA_DIR}/{projectId}.sqlite`이며, 새 파일에 만든 뒤 교체해 구축 실패가 기존 인덱스를 망가뜨리지 않게 한다. 가드용으로 요구사항 ID, API, `testId` 전체 목록을 별도 테이블에 정확히 저장한다.

## 2. 요청 정제 (WBS 4.5.3, FR-02)

Top 3 검색 → 근거를 인용한 정제 문장 N개(기본 4). 각 후보에 근거를 붙인다. 명세에 없는 기능을 요청하면 지어내지 말고, 가장 가까운 명세와 함께 그 사실을 후보 문장에 드러낸다. 프롬프트에서 문서 내용과 사용자 요청은 데이터로 구분해, 문서 속 문장이 지시로 해석되지 않게 한다.

## 3. 시나리오 생성과 가드 (WBS 4.5.3~4.5.5)

LangGraph로 다음 흐름을 구성한다.

```text
retrieve → generate → guard ─ 통과 → 결과
                       └ 실패 → 피드백 주입 → generate (최대 3회)
                       └ CATALOG_GAP → 재생성 없이 종료
```

가드는 LLM이 아니라 **코드**로 검사한다. 판정 자체가 환각하면 안 되기 때문이다.

| 검사 | 실패 종류 |
|---|---|
| Pydantic 스키마 | `SCHEMA_INVALID` |
| `requirementRef`가 지식 베이스에 있음 | `UNKNOWN_REQUIREMENT` |
| 참조 API가 명세에 있음 | `UNKNOWN_API` |
| `testId`가 카탈로그에 있음 | `UNKNOWN_TEST_ID` |
| `{{이름}}`이 `availableVariables`나 앞 단계 캡처에 있음 | `UNKNOWN_VARIABLE` |
| 케이스에 `expect*`, `expectStatus`, `crossChecks` 중 검증이 하나 이상 있음 | `NO_ASSERTION` |
| `crossChecks`마다 `expected`가 있거나, `consistencyOnly`에 값이 실행마다 달라지는 이유가 있음 | `MISSING_EXPECTED` |
| 재시도해도 필요한 요소가 카탈로그에 없음 | `CATALOG_GAP` (사용자가 카탈로그를 고쳐야 함) |

케이스 유형을 정상, 예외, 경계로 나누고, 코드(`SC-`, `TC-`)는 요청의 시작 번호로 코드가 부여한다.

## 4. TestQuery 생성 (WBS 4.6)

**LLM은 코드를 쓰지 않는다** (ADR-005). 스키마에 있는 동작만으로 JSON을 만들고, `testId`와 경로를 가드로 검사한다.

API 검사는 ADR-014를 따른다. 가드를 통과한 뒤 코드가 후처리한다.

- **응답 구조:** `apiRequest`, `waitForApi`마다 `specOperation`과 `expectStatus`로 API 명세에서 응답 스키마를 찾아 `responseSchema`에 복사한다. `$ref`를 모두 풀어서 넣는다. 실행기는 명세 파일에 접근하지 않기 때문이다. LLM이 쓴 `responseSchema`는 버린다. 명세에 없으면 생략한다.
- **인증:** 토큰 방식이면 로그인 응답을 캡처해 `Authorization: Bearer {{이름}}`으로 쓰고, 그 캡처를 `secretCaptures`에 넣는다. 명세의 인증 방식을 보고 정하며, 쿠키 방식이면 헤더를 넣지 않는다.
- **기대값:** 케이스의 `expectedResult`를 근거로 값을 정한다. 초기화된 데이터를 쓰므로 대부분 미리 알 수 있다. `consistencyOnly`는 주문 번호처럼 실행마다 달라지는 값에만 쓴다.

 선택자는 `testId`만 쓴다. 쓰기 API는 `dbChecks`에 넣지 않는다. 테스트 계정 값은 `availableVariables`에 있는 이름을 `{{이름}}`으로만 참조하고, 없는 이름은 가드가 거부한다. TEST_DATA 값은 AI 서버로 오지 않는다. 실행기 `renderSpec`이 실패하면 백엔드가 `previousError`와 함께 다시 호출한다.

## 5. 원인 분석 (FR-06, WBS 4.7)

```text
규칙 기반 분류(failureType, 교차 검증 불일치 위치) → 근거 묶기 → LLM 원인 후보 → 근거 검사
```

- 입력에 있는 값만 인용한다. `evidence`가 입력 값과 대응되지 않는 후보는 버린다. 성공 기준이 "실제 원인 1순위 제시"이므로 그럴듯한 추측은 해롭다.
- `confidencePct`의 기준을 프롬프트에 정의하고 합이 100을 넘지 않게 정규화한다.
- 근거가 부족하면 후보를 적게 낸다. 빈 결과도 정상이다.
- 민감한 값은 분석 입력 전에 가린다.

## 테스트

| 대상 | 방법 |
|---|---|
| 파서, 청킹, 가드, 정규화 | `fake.py`로 단위 테스트 |
| 재생성 루프 | 1회 실패 후 성공, 3회 실패, `CATALOG_GAP` 즉시 종료 |
| API 후처리 | 명세에서 스키마 복사와 `$ref` 풀기, 명세에 없는 작업 생략, LLM이 쓴 스키마 폐기 |
| 기대값 가드 | 검증 없는 케이스 거부, `expected` 누락 거부, 이유 없는 `consistencyOnly` 거부 |
| 검색 | 임시 sqlite-vec로 실제 저장·조회 |
| API | FastAPI TestClient, 응답을 계약 스키마와 대조 |
| 품질 | `references/evaluation.md` |

## 완료 전 검증

```bash
ruff check . && mypy app && pytest
```

실제 LLM으로 돌리지 않은 평가는 미검증으로 보고한다. 측정 없이 수치를 적지 않는다.
