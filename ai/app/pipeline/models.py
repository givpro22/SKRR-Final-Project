"""LLM에게 받는 출력 모델. 계약(전송 형식)과 분리하고 코드가 변환한다.

근거: skrr-ai-pipeline "LLM 출력 모델과 전송 형식 분리".

구조화 출력의 엄격 모드에 맞게 모든 필드를 필수로 두고(없으면 null·빈 배열), 형태가 정해지지 않은 객체를 쓰지 않는다.
근거(Reference)의 점수·발췌, 시나리오·케이스 코드는 LLM이 쓰지 않고 코드가 붙인다.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

CaseTypeOut = Literal["NORMAL", "EXCEPTION", "BOUNDARY"]
ScopeOut = Literal["UI", "API", "DB"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- 요청 정제 (FR-02) ---


class RefinedCandidateOut(_Strict):
    refinedText: str
    # 근거로 쓴 검색 결과의 sourceId. 검색 결과에 없는 ID는 가드가 거부한다.
    referenceIds: list[str]
    # 요청한 기능이 명세에 없어서 가장 가까운 명세로 바꿔 쓴 후보인지
    outOfSpec: bool


class RefinementOut(_Strict):
    candidates: list[RefinedCandidateOut]


# --- 시나리오 계획 ---


class ScenarioPlanItemOut(_Strict):
    title: str
    requirementRef: str | None
    scopes: list[ScopeOut]
    focus: str


class ScenarioPlanOut(_Strict):
    scenarios: list[ScenarioPlanItemOut]


# --- 시나리오 본문 (가드 대상) ---


class ExpectedValueOut(_Strict):
    label: str
    expected: str | None
    consistencyOnly: bool
    reason: str | None


class CaseOut(_Strict):
    title: str
    type: CaseTypeOut
    scopes: list[ScopeOut]
    preconditions: list[str]
    steps: list[str]
    expectedResult: str
    expectedValues: list[ExpectedValueOut]
    # 케이스가 쓰는 카탈로그 data-testid와 API 작업("POST /api/cart/items"). 가드가 존재 여부를 검사한다.
    uiElements: list[str]
    apiOperations: list[str]


class ScenarioDraftOut(_Strict):
    title: str
    requirementRef: str | None
    scopes: list[ScopeOut]
    cases: list[CaseOut]
    # 시나리오에 꼭 필요한데 카탈로그에 없는 화면 요소 설명. 있으면 CATALOG_GAP으로 재생성 없이 끝낸다.
    missingElements: list[str]


# --- TestQuery (FR-04). 맵은 [{name, value}] 배열, body는 JSON 문자열로 받고 코드가 바꾼다 ---

ActionOut = Literal[
    "goto",
    "click",
    "fill",
    "selectOption",
    "expectVisible",
    "expectText",
    "expectCount",
    "press",
    "expectUrl",
    "captureText",
    "waitForApi",
    "apiRequest",
    "expectCapture",
]


class NameValueOut(_Strict):
    name: str
    value: str


class TestQueryStepOut(_Strict):
    id: str
    description: str
    action: ActionOut
    testId: str | None
    path: str | None
    value: str | None
    text: str | None
    match: Literal["EXACT", "CONTAINS", "PREFIX"] | None
    count: int | None
    visible: bool | None
    key: str | None
    captureAs: str | None
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] | None
    trigger: str | None
    expectStatus: int | None
    captures: list[NameValueOut]
    headers: list[NameValueOut]
    bodyJson: str | None
    specOperation: str | None
    capture: str | None
    equals: str | None


class DbCheckOut(_Strict):
    id: str
    label: str
    phase: Literal["BEFORE", "AFTER"]
    path: str
    jsonPath: str
    expected: str | None


class CrossCheckOut(_Strict):
    label: str
    uiCapture: str | None
    apiCapture: str | None
    dbCheckId: str | None
    expected: str | None
    consistencyOnly: bool
    reason: str | None
    normalize: Literal["NONE", "NUMBER", "CURRENCY"]


class TestQueryOut(_Strict):
    title: str
    steps: list[TestQueryStepOut]
    dbChecks: list[DbCheckOut]
    crossChecks: list[CrossCheckOut]
    secretCaptures: list[str]


# --- 실패 원인 분석 (FR-06). 근거는 코드가 붙인 사실 번호(E1…)로만 고른다 ---


class RootCauseOut(_Strict):
    description: str
    # data.facts의 id (예 "E3"). 사실 목록에 없는 id만 있는 후보는 가드가 버린다
    evidenceIds: list[str]
    confidencePct: int
    remediation: str | None


class AnalysisOut(_Strict):
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    affectedFeatures: list[str]
    rootCauses: list[RootCauseOut]
