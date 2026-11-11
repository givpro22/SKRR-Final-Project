"""startScenarioGeneration (FR-03): 시나리오·케이스·기대값, 가드와 재생성."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.api.jobs import Job, JobType
from app.core.config import Settings
from app.main import create_app
from app.pipeline.scenario import GenerationInput, Regenerate, ScenarioGenerator
from tests.conftest import ContractValidator, fake_llm

URL = "/internal/v1/scenarios/generations"


@pytest.fixture
async def client(corpus_project: tuple[Path, str]) -> AsyncIterator[httpx.AsyncClient]:
    kb_dir, _ = corpus_project
    app = create_app(Settings(KB_DATA_DIR=kb_dir), llm=fake_llm())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as c:
        yield c
    await app.state.jobs.shutdown()


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


def _body(project: str, text: str, **extra: Any) -> dict[str, Any]:
    return {"projectId": project, "testRequestCode": "REQ-0142", "requestText": text, **extra}


async def test_generates_scenarios_with_expected_values(
    client: httpx.AsyncClient, corpus_project: tuple[Path, str], contract: ContractValidator
) -> None:
    _, project = corpus_project
    body = _body(project, "장바구니 수량 변경", firstScenarioNumber=3, firstCaseNumber=10)
    contract.validate("ScenarioGenerationRequest", body)
    job = await _run(client, body)
    contract.validate("Job", job)
    assert job["status"] == "SUCCEEDED", job
    result = job["result"]
    contract.validate("ScenarioGenerationResult", result)
    scenarios = result["scenarios"]
    assert [s["code"] for s in scenarios] == [f"SC-{3 + i:02d}" for i in range(len(scenarios))]
    case_codes = [c["code"] for s in scenarios for c in s["testCases"]]
    assert case_codes == [f"TC-{10 + i:02d}" for i in range(len(case_codes))]
    refs = [s["requirementRef"] for s in scenarios]
    assert "FR-CART-02" in refs
    first = scenarios[refs.index("FR-CART-02")]
    assert all(s["guard"] == {"passed": True, "attempts": 1, "failures": []} for s in scenarios)
    assert first["scopes"] == sorted(first["scopes"], key=["UI", "API", "DB"].index)
    assert {c["type"] for c in first["testCases"]} >= {"NORMAL", "EXCEPTION", "BOUNDARY"}
    for s in scenarios:
        assert s["references"] and s["references"][0]["sourceId"] == s["requirementRef"]
        for case in s["testCases"]:
            assert case["expectedResult"]
            assert case["expectedValues"], "ADR-017: 케이스마다 기대값 1개 이상"
            for ev in case["expectedValues"]:
                assert ("expected" in ev) != bool(ev.get("consistencyOnly"))
                if ev.get("consistencyOnly"):
                    assert ev["reason"]
    # 명세 근거: 정상 케이스의 상태 코드 기대값은 API 명세의 2xx다
    normal = next(c for c in first["testCases"] if c["type"] == "NORMAL")
    assert {"label": "PATCH /cart/items/{productId} 응답 상태", "expected": "200"} in normal["expectedValues"]
    boundary = next(c for c in first["testCases"] if c["type"] == "BOUNDARY")
    assert "100" in boundary["title"]
    # 단계 문장의 testId·API는 모두 카탈로그·명세에 있는 것 (가드 통과)
    assert any("`cart-item-quantity`" in step for step in normal["steps"])


async def test_guard_retry_then_pass(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    job = await _run(client, _body(project, "장바구니 상품 삭제 #fake-guard-retry"))
    first = job["result"]["scenarios"][0]
    assert first["guard"] == {"passed": True, "attempts": 2, "failures": []}
    steps = " ".join(s for c in first["testCases"] for s in c["steps"])
    assert "cart-remove-all-button" not in steps


async def test_guard_fail_after_three_attempts(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    job = await _run(client, _body(project, "장바구니 상품 삭제 #fake-guard-fail"))
    assert job["status"] == "SUCCEEDED"
    first = job["result"]["scenarios"][0]
    assert first["guard"]["passed"] is False and first["guard"]["attempts"] == 3
    assert first["guard"]["failures"] == [
        {
            "kind": "UNKNOWN_API",
            "message": "API 명세에 'DELETE /api/cart/all' 작업이 없어요",
            "subject": "DELETE /api/cart/all",
        }
    ]
    assert first["testCases"], "가드 실패해도 마지막 결과를 보여 준다"
    # 나머지 시나리오는 영향받지 않는다
    assert all(s["guard"]["passed"] for s in job["result"]["scenarios"][1:])


async def test_catalog_gap_stops_without_regeneration(
    client: httpx.AsyncClient, corpus_project: tuple[Path, str]
) -> None:
    _, project = corpus_project
    job = await _run(client, _body(project, "장바구니 상품 삭제 #fake-catalog-gap"))
    guard = job["result"]["scenarios"][0]["guard"]
    assert guard["passed"] is False and guard["attempts"] == 1
    assert [f["kind"] for f in guard["failures"]] == ["CATALOG_GAP"]
    assert guard["failures"][0]["subject"] == "장바구니 전체 비우기 버튼"


async def test_schema_invalid_is_regenerated(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    job = await _run(client, _body(project, "쿠폰 적용 #fake-schema-invalid"))
    assert job["result"]["scenarios"][0]["guard"] == {"passed": True, "attempts": 2, "failures": []}


async def test_regenerate_one_scenario(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    body = _body(
        project,
        "장바구니 수량 변경",
        firstCaseNumber=21,
        regenerate={
            "scenarioCode": "SC-07",
            "previous": {
                "code": "SC-07",
                "title": "장바구니 수량 변경 검증",
                "requirementRef": "FR-CART-02",
                "scopes": ["UI", "API"],
                "references": [],
                "guard": {"passed": True, "attempts": 1, "failures": []},
                "testCases": [],
            },
            "feedback": "수량 0 입력도 확인해 주세요",
        },
    )
    res = await client.post(URL, json=body)
    assert res.json()["progress"]["scenarioCode"] == "SC-07"
    job = await _run(client, body)
    scenarios = job["result"]["scenarios"]
    assert [s["code"] for s in scenarios] == ["SC-07"]
    assert scenarios[0]["testCases"][0]["code"] == "TC-21"
    assert any("수량 0 입력도 확인해 주세요" in p for p in scenarios[0]["testCases"][0]["preconditions"])


async def test_llm_down_fails_job(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    job = await _run(client, _body(project, "주문 취소 #fake-llm-down"))
    assert job["status"] == "FAILED" and job["error"]["code"] == "LLM_UNAVAILABLE"


async def test_knowledge_base_missing(client: httpx.AsyncClient) -> None:
    job = await _run(client, _body(str(uuid.uuid4()), "주문 취소"))
    assert job["error"]["code"] == "KNOWLEDGE_BASE_MISSING"


async def test_progress_reports_scenario_and_guard_message(corpus_project: tuple[Path, str]) -> None:
    kb_dir, project = corpus_project
    job = Job(job_id="t", type=JobType.SCENARIO_GENERATE)
    seen: list[dict[str, Any]] = []
    original = job.set_progress

    def spy(phase: str, percent: int, message: str, **extra: int | None) -> None:
        original(phase, percent, message, **extra)
        seen.append(job.to_contract()["progress"])

    job.set_progress = spy  # type: ignore[method-assign]
    inp = GenerationInput(project, "REQ-1", "장바구니 상품 삭제 #fake-guard-retry")
    await ScenarioGenerator(fake_llm(), kb_dir).run(job, inp)
    retry = [p for p in seen if p.get("attempt") == 2 and p["phase"] == "GENERATE"]
    assert retry and retry[0]["scenarioCode"] == "SC-01"
    assert retry[0]["message"] == "카탈로그에 'cart-remove-all-button' 요소가 없어 재생성 중"
    assert not any(p.get("message", "").startswith("가드 실패") for p in seen)  # Q-M2-1: 접두어는 화면이 붙인다
    assert retry[0]["maxAttempts"] == 3
    percents = [p["percent"] for p in seen]
    assert percents == sorted(percents) and percents[-1] == 100
    assert "scenarioCode" not in job.to_contract()["progress"]


async def test_regenerate_uses_given_code_without_plan(corpus_project: tuple[Path, str]) -> None:
    kb_dir, project = corpus_project
    llm = fake_llm()
    inp = GenerationInput(project, "REQ-1", "장바구니 담기", regenerate=Regenerate("SC-02", None, None))
    result = await ScenarioGenerator(llm, kb_dir).run(Job(job_id="t", type=JobType.SCENARIO_GENERATE), inp)
    assert [s["code"] for s in result["scenarios"]] == ["SC-02"]


@pytest.mark.parametrize(
    "extra",
    [
        {"testRequestCode": ""},
        {"requestText": ""},
        {"firstScenarioNumber": 0},
        {"regenerate": {"feedback": "코드 없음"}},
    ],
)
async def test_bad_request(client: httpx.AsyncClient, extra: dict[str, Any], contract: ContractValidator) -> None:
    res = await client.post(URL, json={**_body(str(uuid.uuid4()), "x"), **extra})
    assert res.status_code == 400
    contract.validate("Problem", res.json())


async def test_guard_retry_twice_then_pass(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    job = await _run(client, _body(project, "장바구니 상품 삭제 #fake-guard-retry-2"))
    assert job["result"]["scenarios"][0]["guard"] == {"passed": True, "attempts": 3, "failures": []}


async def test_repeated_missing_test_id_escalates_to_catalog_gap(
    client: httpx.AsyncClient, corpus_project: tuple[Path, str]
) -> None:
    _, project = corpus_project
    job = await _run(client, _body(project, "장바구니 상품 삭제 #fake-catalog-gap-repeat"))
    guard = job["result"]["scenarios"][0]["guard"]
    assert guard["passed"] is False and guard["attempts"] == 2
    assert [(f["kind"], f.get("subject")) for f in guard["failures"]] == [("CATALOG_GAP", "cart-remove-all-button")]


async def test_fake_delay_exposes_guard_retry_progress(corpus_project: tuple[Path, str]) -> None:
    """FAKE_LLM_DELAY_MS가 있으면 진행 중 GUARD_RETRY(attempt 2)를 조회로 볼 수 있다."""
    from app.llm.client import ResilientLLMClient
    from app.llm.fake_responders import make_fake_llm

    kb_dir, project = corpus_project
    llm = ResilientLLMClient(make_fake_llm(64, delay_seconds=0.05), max_retries=0)
    app = create_app(Settings(KB_DATA_DIR=kb_dir), llm=llm)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as c:
        res = await c.post(URL, json=_body(project, "장바구니 상품 삭제 #fake-guard-retry"))
        job_id = res.json()["jobId"]
        seen = []
        for _ in range(200):
            job = (await c.get(f"/internal/v1/jobs/{job_id}")).json()
            seen.append(job["progress"])
            if job["status"] == "SUCCEEDED":
                break
            await asyncio.sleep(0.01)
    retry = [p for p in seen if p.get("attempt") == 2 and p.get("scenarioCode") == "SC-01"]
    assert retry, seen
    assert retry[0]["message"].startswith("카탈로그에 'cart-remove-all-button'")


def test_delay_setting_reaches_fake_client() -> None:
    from app.llm.factory import build_llm_client

    llm = build_llm_client(Settings(FAKE_LLM_DELAY_MS=250))
    assert llm._inner.delay_seconds == 0.25  # type: ignore[attr-defined]
