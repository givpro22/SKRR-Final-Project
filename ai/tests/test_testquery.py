"""startTestQueryGeneration (FR-04): 변환, 가드, 명세 후처리, 재시도."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.api.jobs import Job, JobType
from app.core.codes import GuardFailureKind as K
from app.core.config import Settings
from app.guards.testquery import check_test_query
from app.knowledge.store import KnowledgeBase, kb_path
from app.main import create_app
from app.pipeline.context import Catalog
from app.pipeline.openapi import response_schema, server_base_path, to_json_schema
from app.pipeline.scenario import GenerationInput, ScenarioGenerator
from app.pipeline.testquery import SCHEMA_PATH, post_process, schema_errors
from tests.conftest import CONTRACTS, ContractValidator, fake_llm

URL = "/internal/v1/test-queries/generations"
VARS = ["memberEmail", "memberPassword", "productId"]


@pytest.fixture
async def client(corpus_project: tuple[Path, str]) -> AsyncIterator[httpx.AsyncClient]:
    kb_dir, _ = corpus_project
    app = create_app(Settings(KB_DATA_DIR=kb_dir), llm=fake_llm())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as c:
        yield c
    await app.state.jobs.shutdown()


@pytest.fixture
def catalog(corpus_project: tuple[Path, str]) -> Catalog:
    kb_dir, project = corpus_project
    with KnowledgeBase(kb_path(kb_dir, project)) as kb:
        return Catalog.load(kb)


async def _cases(corpus_project: tuple[Path, str], text: str) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    kb_dir, project = corpus_project
    result = await ScenarioGenerator(fake_llm(), kb_dir).run(
        Job(job_id="s", type=JobType.SCENARIO_GENERATE), GenerationInput(project, "REQ-1", text)
    )
    return [(s, c) for s in result["scenarios"] for c in s["testCases"]]


async def _run(client: httpx.AsyncClient, body: dict[str, Any]) -> dict[str, Any]:
    res = await client.post(URL, json=body)
    assert res.status_code == 202, res.text
    job_id = res.json()["jobId"]
    for _ in range(500):
        job: dict[str, Any] = (await client.get(f"/internal/v1/jobs/{job_id}")).json()
        if job["status"] in {"SUCCEEDED", "FAILED", "CANCELLED"}:
            return job
        await asyncio.sleep(0.01)
    raise AssertionError("작업이 끝나지 않음")


def _body(project: str, scenario: dict[str, Any], case: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {
        "projectId": project,
        "scenario": {
            "code": scenario["code"],
            "title": scenario["title"],
            "requirementRef": scenario["requirementRef"],
        },
        "testCase": case,
        "availableVariables": VARS,
        **extra,
    }


def test_schema_copy_matches_contract() -> None:
    """실행 이미지에는 docs가 없으므로 app/contracts에 복사본을 둔다. 계약과 같아야 한다."""
    assert json.loads(SCHEMA_PATH.read_text()) == json.loads(
        (CONTRACTS / "schemas" / "test-query.schema.json").read_text()
    )


async def test_all_generated_cases_become_valid_test_queries(
    client: httpx.AsyncClient, corpus_project: tuple[Path, str], contract: ContractValidator
) -> None:
    _, project = corpus_project
    pairs = await _cases(corpus_project, "장바구니 수량 변경") + await _cases(corpus_project, "회원 로그인")
    for scenario, case in pairs:
        body = _body(project, scenario, case)
        contract.validate("TestQueryGenerationRequest", body)
        job = await _run(client, body)
        contract.validate("Job", job)
        assert job["status"] == "SUCCEEDED", job
        result = job["result"]
        contract.validate("TestQueryGenerationResult", result)
        assert result["guard"] == {"passed": True, "attempts": 1, "failures": []}, (case["code"], result["guard"])
        tq = result["testQuery"]
        assert tq["testCaseCode"] == case["code"] and tq["variables"] == {}
        # 테스트 데이터 값은 TestQuery에 굳히지 않는다 (A16): 변수 이름으로만 참조
        text = json.dumps(tq, ensure_ascii=False)
        assert "member@example.test" not in text
        assert "{{memberPassword}}" in text


async def test_spec_post_processing(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    scenario, case = next(
        (s, c) for s, c in await _cases(corpus_project, "장바구니 수량 변경") if c["type"] == "NORMAL"
    )
    tq = (await _run(client, _body(project, scenario, case)))["result"]["testQuery"]
    api = next(s for s in tq["steps"] if s["action"] in {"apiRequest", "waitForApi"})
    assert api["path"] == "/api/cart/items/{{productId}}"  # 서버 경로(/api) + 명세 경로, 경로 변수는 {{이름}}
    assert api["specOperation"] == "PATCH /cart/items/{productId}"
    assert api["responseSchema"]["required"] == ["items", "totalAmount"]
    # $ref(CartItem)가 풀려 있다
    assert api["responseSchema"]["properties"]["items"]["items"]["properties"]["quantity"]["maximum"] == 99
    cc = tq["crossChecks"][0]
    assert cc["consistencyOnly"] is True and cc["uiCapture"].startswith("ui_") and cc["apiCapture"] == "api_totalamount"


async def test_exception_case_uses_error_inputs(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    scenario, case = next((s, c) for s, c in await _cases(corpus_project, "회원 로그인") if c["type"] == "EXCEPTION")
    tq = (await _run(client, _body(project, scenario, case)))["result"]["testQuery"]
    wait = next(s for s in tq["steps"] if s["action"] == "waitForApi")
    assert wait["expectStatus"] == 401
    assert any(s.get("value") == "wrong-password" for s in tq["steps"])


@pytest.mark.parametrize(
    ("mark", "passed", "attempts", "kind"),
    [
        ("#fake-tq-retry", True, 2, None),
        ("#fake-tq-fail", False, 3, "UNKNOWN_API"),
        ("#fake-tq-not-approved", False, 3, "EXPECTED_NOT_APPROVED"),
    ],
)
async def test_guard_paths(
    client: httpx.AsyncClient,
    corpus_project: tuple[Path, str],
    contract: ContractValidator,
    mark: str,
    passed: bool,
    attempts: int,
    kind: str | None,
) -> None:
    _, project = corpus_project
    scenario, case = (await _cases(corpus_project, "장바구니 담기"))[0]
    case = {**case, "title": f"{case['title']} {mark}"}
    job = await _run(client, _body(project, scenario, case))
    assert job["status"] == "SUCCEEDED"
    contract.validate("TestQueryGenerationResult", job["result"])
    guard = job["result"]["guard"]
    assert guard["passed"] is passed and guard["attempts"] == attempts
    if kind:
        assert kind in {f["kind"] for f in guard["failures"]}
    else:
        assert guard["failures"] == []


async def test_invalid_output_fails_job(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    scenario, case = (await _cases(corpus_project, "장바구니 담기"))[0]
    job = await _run(client, _body(project, scenario, {**case, "title": "x #fake-tq-invalid"}))
    assert job["status"] == "FAILED" and job["error"]["code"] == "INVALID_LLM_OUTPUT"
    assert job["result"] is None


@pytest.mark.parametrize(
    "case_over",
    [
        {"code": "TC-1"},
        {"expectedValues": []},
        {"expectedValues": [{"label": "x", "expected": "1", "consistencyOnly": True, "reason": "r"}]},
        {"expectedValues": [{"label": "x", "consistencyOnly": True}]},
        {"type": "SMOKE"},
    ],
)
async def test_bad_request(
    client: httpx.AsyncClient, corpus_project: tuple[Path, str], contract: ContractValidator, case_over: dict[str, Any]
) -> None:
    _, project = corpus_project
    scenario, case = (await _cases(corpus_project, "장바구니 담기"))[0]
    res = await client.post(URL, json=_body(project, scenario, {**case, **case_over}))
    assert res.status_code == 400
    contract.validate("Problem", res.json())


# --- 가드 단위 ---


def _tq(*steps: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "testCaseCode": "TC-01",
        "title": "t",
        "variables": {},
        "steps": list(steps),
        **extra,
    }


def _s(sid: str, action: str, **fields: Any) -> dict[str, Any]:
    return {"id": sid, "description": sid, "action": action, **fields}


APPROVED = [
    {"label": "응답 상태", "expected": "201"},
    {"label": "합계 (화면·API·DB)", "consistencyOnly": True, "reason": "r"},
]
GOOD = [
    _s("s1", "goto", path="/products/{{productId}}"),
    _s("s2", "fill", testId="product-qty-input", value="2"),
    _s(
        "s3",
        "waitForApi",
        method="POST",
        path="/api/cart/items",
        trigger="cart-add-button",
        expectStatus=201,
        captures={"apiTotal": "$.price"},
    ),
    _s("s4", "captureText", testId="cart-total-amount", **{"as": "uiTotal"}),
]
GOOD_CC = [
    {
        "label": "합계 (화면·API·DB)",
        "uiCapture": "uiTotal",
        "apiCapture": "apiTotal",
        "consistencyOnly": True,
        "reason": "r",
    }
]


def kinds(tq: dict[str, Any], catalog: Catalog) -> list[K]:
    return [f.kind for f in check_test_query(tq, catalog, VARS, APPROVED)]


def test_good_query_passes(catalog: Catalog) -> None:
    tq = _tq(*GOOD, crossChecks=GOOD_CC)
    assert check_test_query(tq, catalog, VARS, APPROVED) == []
    assert schema_errors(post_process(tq, catalog)) == []


@pytest.mark.parametrize(
    ("steps", "extra", "expected"),
    [
        ([_s("x", "click", testId="ghost-button")], {}, K.UNKNOWN_TEST_ID),
        ([_s("x", "apiRequest", method="DELETE", path="/api/cart", expectStatus=204)], {}, K.UNKNOWN_API),
        ([_s("x", "goto", path="/orders/{{orderNo}}")], {}, K.UNKNOWN_VARIABLE),
        # 캡처는 정의된 다음 단계부터만 쓸 수 있다
        (
            [
                _s("a", "goto", path="/x/{{later}}"),
                _s("b", "captureText", testId="cart-total-amount", **{"as": "later"}),
            ],
            {},
            K.UNKNOWN_VARIABLE,
        ),
        ([_s("b", "captureText", testId="cart-total-amount", **{"as": "productId"})], {}, K.UNKNOWN_VARIABLE),
        (
            [_s("x", "apiRequest", method="GET", path="/api/cart", headers={"Cookie": "a"}, expectStatus=200)],
            {},
            K.SCHEMA_INVALID,
        ),
        ([_s("x", "expectCapture", capture="nope", equals="201")], {}, K.UNKNOWN_VARIABLE),
        ([], {"crossChecks": [{**GOOD_CC[0], "consistencyOnly": None, "expected": "999"}]}, K.EXPECTED_NOT_APPROVED),
        ([], {"crossChecks": [{"label": "모르는 항목", "expected": "1"}]}, K.EXPECTED_NOT_APPROVED),
        ([], {"crossChecks": [{"label": "합계 (화면·API·DB)", "consistencyOnly": True}]}, K.MISSING_EXPECTED),
        (
            [],
            {"dbChecks": [{"id": "d", "label": "x", "phase": "AFTER", "path": "/api/cart/items", "jsonPath": "$"}]},
            K.UNKNOWN_API,
        ),
        ([], {"secretCaptures": ["nope"]}, K.UNKNOWN_VARIABLE),
    ],
)
def test_guard_kinds(catalog: Catalog, steps: list[dict[str, Any]], extra: dict[str, Any], expected: K) -> None:
    ccs = extra.pop("crossChecks", GOOD_CC)
    ccs = [{k: v for k, v in cc.items() if v is not None} for cc in ccs]
    tq = _tq(*GOOD, *steps, crossChecks=ccs, **extra)
    assert expected in kinds(tq, catalog)


def test_no_assertion_and_missing_coverage(catalog: Catalog) -> None:
    tq = _tq(_s("s1", "goto", path="/cart"))
    got = kinds(tq, catalog)
    assert K.NO_ASSERTION in got
    assert got.count(K.MISSING_EXPECTED) == 2  # 승인된 기대값 2개 모두 검증 단계 없음


def test_read_only_db_check_passes(catalog: Catalog) -> None:
    db = [
        {
            "id": "cart_rows",
            "label": "장바구니 행",
            "phase": "AFTER",
            "path": "/api/test/query/cart-items?memberEmail={{memberEmail}}",
            "jsonPath": "$[0].quantity",
        }
    ]
    cc = [*GOOD_CC, {"label": "응답 상태", "dbCheckId": "cart_rows", "expected": "201"}]
    assert check_test_query(_tq(*GOOD, crossChecks=cc, dbChecks=db), catalog, VARS, APPROVED) == []


def test_post_process_marks_token_secret_and_drops_llm_schema(catalog: Catalog) -> None:
    tq = _tq(
        _s(
            "login",
            "apiRequest",
            method="POST",
            path="/api/auth/login",
            body={"email": "{{memberEmail}}"},
            expectStatus=200,
            captures={"token": "$.accessToken"},
            responseSchema={"type": "string"},
        ),
        _s(
            "cart",
            "apiRequest",
            method="GET",
            path="/api/cart",
            headers={"Authorization": "Bearer {{token}}"},
            expectStatus=200,
        ),
    )
    out = post_process(tq, catalog)
    assert out["secretCaptures"] == ["token"]
    assert out["steps"][0]["responseSchema"]["required"] == ["accessToken"]  # LLM 값 대신 명세 값
    assert out["steps"][1]["specOperation"] == "GET /cart"
    assert schema_errors(out) == []


def test_openapi_helpers() -> None:
    spec = {
        "servers": [{"url": "https://x.test/api/v1/"}],
        "components": {
            "schemas": {
                "Node": {
                    "type": "object",
                    "nullable": True,
                    "properties": {"next": {"$ref": "#/components/schemas/Node"}},
                }
            }
        },
        "paths": {
            "/n": {
                "get": {
                    "responses": {
                        "200": {
                            "description": "",
                            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Node"}}},
                        }
                    }
                }
            }
        },
    }
    assert server_base_path(spec) == "/api/v1"
    schema = response_schema(spec, "GET", "/n", 200)
    assert schema is not None and schema["type"] == ["object", "null"]
    assert schema["properties"]["next"] == {}  # 순환 참조는 한 번 풀고 멈춘다
    assert response_schema(spec, "GET", "/n", 404) is None
    assert to_json_schema(spec, {"type": "string", "example": "x"}) == {"type": "string"}


def test_expect_capture_with_unapproved_value(catalog: Catalog) -> None:
    tq = _tq(*GOOD, _s("x", "expectCapture", capture="uiTotal", equals="1"), crossChecks=GOOD_CC)
    assert kinds(tq, catalog) == [K.EXPECTED_NOT_APPROVED]


async def test_not_found_case_calls_api_directly_with_slash_kept(
    client: httpx.AsyncClient, corpus_project: tuple[Path, str]
) -> None:
    """Q-M3-2: 404 케이스 경로는 '/'를 지키고(/api/cart/items/999999), 화면으로 만들 수 없으니 apiRequest로 부른다."""
    _, project = corpus_project
    pairs = await _cases(corpus_project, "장바구니 상품 삭제")
    scenario, case = next((s, c) for s, c in pairs if c["type"] == "EXCEPTION" and "404" in c["title"])
    job = await _run(client, _body(project, scenario, case))
    assert job["result"]["guard"]["passed"] is True, job["result"]["guard"]
    api = next(s for s in job["result"]["testQuery"]["steps"] if s.get("expectStatus") == 404)
    assert api["action"] == "apiRequest"
    assert api["path"] == "/api/cart/items/999999"


async def test_dbcheck_outside_marker(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    scenario, case = (await _cases(corpus_project, "장바구니 담기"))[0]
    job = await _run(client, _body(project, scenario, {**case, "title": f"{case['title']} #fake-dbcheck-outside"}))
    tq = job["result"]["testQuery"]
    assert job["result"]["guard"]["passed"] is True
    assert tq["dbChecks"][0]["path"] == "/api/cart"  # 읽기 전용 GET이지만 조회 API(/api/test/query) 밖


async def test_wait_for_api_keeps_unknown_path_param(
    client: httpx.AsyncClient, corpus_project: tuple[Path, str]
) -> None:
    """화면 동작이 부르는 API의 모르는 id는 {이름} 자리로 둔다 (주문 취소 → /api/orders/{orderId}/cancel)."""
    _, project = corpus_project
    scenario, case = next(
        (s, c) for s, c in await _cases(corpus_project, "주문 취소") if c["type"] == "NORMAL" and "취소" in c["title"]
    )
    tq = (await _run(client, _body(project, scenario, case)))["result"]["testQuery"]
    wait = next(s for s in tq["steps"] if s["action"] == "waitForApi")
    assert wait["path"] == "/api/orders/{orderId}/cancel"
    assert wait["specOperation"] == "POST /orders/{orderId}/cancel"


def test_db_check_must_be_under_query_api_base(catalog: Catalog) -> None:
    """queryApiBaseUrl이 있으면 dbChecks 경로가 그 경로 아래여야 한다 (ai-api TestQueryGenerationRequest)."""
    outside = [{"id": "d", "label": "장바구니", "phase": "AFTER", "path": "/api/cart", "jsonPath": "$.totalAmount"}]
    inside = [
        {
            "id": "d",
            "label": "장바구니",
            "phase": "AFTER",
            "path": "/api/test/query/cart-items?memberEmail={{memberEmail}}",
            "jsonPath": "$[0].quantity",
        }
    ]

    def kinds_with(db: list[dict[str, Any]], base: str | None) -> list[K]:
        return [
            f.kind
            for f in check_test_query(_tq(*GOOD, crossChecks=GOOD_CC, dbChecks=db), catalog, VARS, APPROVED, base)
        ]

    assert K.UNKNOWN_API in kinds_with(outside, "/api/test/query")
    assert kinds_with(inside, "/api/test/query") == []
    # 없으면 지금처럼 명세의 읽기 전용 GET만 본다 (/api/cart는 GET이라 통과)
    assert kinds_with(outside, None) == []


async def test_query_api_base_url_in_request(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    scenario, case = (await _cases(corpus_project, "장바구니 담기"))[0]
    body = _body(
        project,
        scenario,
        {**case, "title": f"{case['title']} #fake-dbcheck-outside"},
        queryApiBaseUrl="http://shop.test/api/test/query",
    )
    job = await _run(client, body)
    guard = job["result"]["guard"]
    assert guard["passed"] is False
    assert "UNKNOWN_API" in {f["kind"] for f in guard["failures"]}
