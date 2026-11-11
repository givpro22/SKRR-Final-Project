"""startRequestRefinement (FR-02)."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.core.config import Settings
from app.main import create_app
from tests.conftest import ContractValidator, fake_llm

URL = "/internal/v1/requests/refinements"


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
    for _ in range(300):
        job: dict[str, Any] = (await client.get(f"/internal/v1/jobs/{job_id}")).json()
        if job["status"] in {"SUCCEEDED", "FAILED", "CANCELLED"}:
            return job
        await asyncio.sleep(0.01)
    raise AssertionError("작업이 끝나지 않음")


async def test_refinement_candidates_cite_retrieved_specs(
    client: httpx.AsyncClient, corpus_project: tuple[Path, str], contract: ContractValidator
) -> None:
    _, project = corpus_project
    body = {"projectId": project, "text": "장바구니 수량 변경"}
    contract.validate("RefinementRequest", body)
    job = await _run(client, body)
    contract.validate("Job", job)
    assert job["status"] == "SUCCEEDED", job
    assert job["type"] == "REQUEST_REFINE"
    result = job["result"]
    contract.validate("RefinementResult", result)
    candidates = result["candidates"]
    assert 1 <= len(candidates) <= 4
    for cand in candidates:
        assert cand["refinedText"]
        assert cand["references"], "후보마다 근거가 있어야 한다"
        assert all(0 <= r["score"] <= 1 and r["excerpt"] for r in cand["references"])
    # 기본 topK 3 안의 근거만 인용하고, 첫 근거가 기능 이름의 요구사항이다
    cited = {r["sourceId"] for c in candidates for r in c["references"]}
    assert len(cited) <= 3
    assert candidates[0]["references"][0]["sourceId"] == "FR-CART-02"
    assert "FR-CART-02" in candidates[0]["refinedText"]


async def test_candidate_count_and_top_k(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    job = await _run(client, {"projectId": project, "text": "쿠폰 적용", "candidateCount": 2, "topK": 1})
    cands = job["result"]["candidates"]
    assert len(cands) == 2
    assert {r["sourceId"] for c in cands for r in c["references"]} == {"FR-CPN-02"}


async def test_out_of_spec_request_is_flagged(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    job = await _run(client, {"projectId": project, "text": "포인트 적립"})
    first = job["result"]["candidates"][0]
    assert "명세에 없는 기능" in first["refinedText"]
    assert first["references"], "명세에 없어도 가장 가까운 근거를 붙인다"


async def test_bad_reference_is_retried(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    job = await _run(client, {"projectId": project, "text": "주문 취소 #fake-bad-reference"})
    assert job["status"] == "SUCCEEDED"
    assert job["progress"]["attempt"] == 2
    refs = {r["sourceId"] for c in job["result"]["candidates"] for r in c["references"]}
    assert "FR-NOPE-99" not in refs


async def test_llm_down(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    job = await _run(client, {"projectId": project, "text": "주문 취소 #fake-llm-down"})
    assert job["status"] == "FAILED"
    assert job["error"]["code"] == "LLM_UNAVAILABLE" and job["error"]["retryable"] is True
    assert job["result"] is None


async def test_knowledge_base_missing(client: httpx.AsyncClient, contract: ContractValidator) -> None:
    job = await _run(client, {"projectId": str(uuid.uuid4()), "text": "장바구니 담기"})
    contract.validate("Job", job)
    assert job["status"] == "FAILED"
    assert job["error"]["code"] == "KNOWLEDGE_BASE_MISSING" and job["error"]["retryable"] is False


async def test_embedding_model_mismatch(corpus_project: tuple[Path, str]) -> None:
    kb_dir, project = corpus_project
    app = create_app(Settings(KB_DATA_DIR=kb_dir), llm=fake_llm(dim=32))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as c:
        job = await _run(c, {"projectId": project, "text": "장바구니 담기"})
    assert job["error"]["code"] == "EMBEDDING_MODEL_MISMATCH" and job["error"]["retryable"] is False


@pytest.mark.parametrize(
    "body",
    [
        {"text": "x"},
        {"projectId": "not-uuid", "text": "x"},
        {"projectId": str(uuid.uuid4()), "text": ""},
        {"projectId": str(uuid.uuid4()), "text": "가" * 501},
        {"projectId": str(uuid.uuid4()), "text": "x", "candidateCount": 7},
        {"projectId": str(uuid.uuid4()), "text": "x", "topK": 0},
    ],
)
async def test_bad_request(client: httpx.AsyncClient, body: dict[str, Any], contract: ContractValidator) -> None:
    res = await client.post(URL, json=body)
    assert res.status_code == 400
    contract.validate("Problem", res.json())


async def test_refine_invalid_output(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    job = await _run(client, {"projectId": project, "text": "주문 취소 #fake-refine-invalid"})
    assert job["status"] == "FAILED"
    assert job["error"]["code"] == "INVALID_LLM_OUTPUT" and job["error"]["retryable"] is False
    assert job["progress"]["attempt"] == 3
