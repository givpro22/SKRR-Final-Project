"""startFailureAnalysis (FR-06): 근거는 요청 값만, 근거 없는 후보 제거, 신뢰도 정규화, 비슷한 요소 제안."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import yaml

from app.core.config import Settings
from app.main import create_app
from app.pipeline.analysis import build_facts, ground_and_rank, mask_sensitive
from app.pipeline.models import AnalysisOut
from tests.conftest import ContractValidator, fake_llm

URL = "/internal/v1/failure-analyses"
DATASET = Path(__file__).resolve().parents[1] / "evals" / "datasets" / "fr06_faults.yaml"
FAULTS = {item["faultId"]: item for item in yaml.safe_load(DATASET.read_text(encoding="utf-8"))}


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


def _body(project: str, fault: str, **over: Any) -> dict[str, Any]:
    return {"projectId": project, **FAULTS[fault]["request"], **over}


async def test_result_matches_contract_and_cites_request_values(
    client: httpx.AsyncClient, corpus_project: tuple[Path, str], contract: ContractValidator
) -> None:
    _, project = corpus_project
    body = _body(project, "cart-total-ui-mismatch")
    contract.validate("FailureAnalysisRequest", body)
    job = await _run(client, body)
    contract.validate("Job", job)
    assert job["status"] == "SUCCEEDED", job
    result = job["result"]
    contract.validate("FailureAnalysisResult", result)
    assert "failureType" not in result  # 실패 유형은 입력이고 돌려주지 않는다
    assert result["severity"] == "HIGH"  # 금액 불일치
    assert result["affectedFeatures"][0] == "장바구니 합계 금액 확인 (FR-CART-04)"
    top = result["rootCauses"][0]
    assert top["rank"] == 1 and "화면 표시" in top["description"]
    facts = {f.text for f in build_facts({**body})}
    assert all(e in facts for c in result["rootCauses"] for e in c["evidence"])
    assert sum(c["confidencePct"] for c in result["rootCauses"]) <= 100


async def test_ungrounded_candidate_is_dropped(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    body = _body(project, "cart-add-500", caseTitle="장바구니 담기 #fake-analysis-ungrounded")
    causes = (await _run(client, body))["result"]["rootCauses"]
    assert causes and all(c["description"] != "근거 없는 추측" for c in causes)
    assert causes[0]["rank"] == 1 and "서버 오류" in causes[0]["description"]


async def test_empty_result_is_normal(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    job = await _run(client, _body(project, "cart-add-500", caseTitle="x #fake-analysis-empty"))
    assert job["status"] == "SUCCEEDED" and job["result"]["rootCauses"] == []


async def test_element_not_found_suggests_similar_catalog_element(
    client: httpx.AsyncClient, corpus_project: tuple[Path, str]
) -> None:
    """ADR-015: 판정은 그대로, 카탈로그의 비슷한 요소를 '바뀌었을 가능성' 후보로."""
    _, project = corpus_project
    detail = "locator.click: Timeout 10000ms exceeded.\n(call log) waiting for getByTestId('cart-delete-button')"
    body = _body(
        project,
        "remove-button-missing",
        failureMessage="locator.click: Timeout 10000ms exceeded.",
        steps=[{"order": 3, "kind": "UI", "title": "삭제 버튼 클릭", "status": "FAILED", "detail": detail}],
    )
    causes = (await _run(client, body))["result"]["rootCauses"]
    assert "cart-delete-button" in causes[0]["description"]
    similar = [c for c in causes if "바뀌었을 가능성" in c["description"]]
    assert similar and "cart-remove-button" in similar[0]["description"]
    assert any(e.startswith("카탈로그 요소 cart-remove-button") for e in similar[0]["evidence"])


async def test_works_without_knowledge_base(client: httpx.AsyncClient) -> None:
    job = await _run(client, _body(str(uuid.uuid4()), "remove-button-missing"))
    assert job["status"] == "SUCCEEDED"
    assert job["result"]["rootCauses"][0]["description"].startswith("화면에서 'cart-remove-button'")


async def test_llm_down(client: httpx.AsyncClient, corpus_project: tuple[Path, str]) -> None:
    _, project = corpus_project
    job = await _run(client, _body(project, "cart-add-500", caseTitle="x #fake-llm-down"))
    assert job["status"] == "FAILED" and job["error"]["code"] == "LLM_UNAVAILABLE"


@pytest.mark.parametrize(
    "over",
    [{"failureType": "SOMETHING"}, {"steps": "x"}, {"verifications": [{"itemLabel": "a", "verdict": "SAME"}]}],
)
async def test_bad_request(
    client: httpx.AsyncClient, corpus_project: tuple[Path, str], contract: ContractValidator, over: dict[str, Any]
) -> None:
    _, project = corpus_project
    res = await client.post(URL, json=_body(project, "cart-add-500", **over))
    assert res.status_code == 400
    contract.validate("Problem", res.json())


def test_mask_sensitive_values() -> None:
    text = 'Authorization: Bearer abcdefgh12345678 {"password":"hunter22"} eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl'
    masked = mask_sensitive(text)
    assert "abcdefgh12345678" not in masked and "hunter22" not in masked and "eyJzdWIiOi" not in masked


def test_ground_and_rank_normalizes_and_limits() -> None:
    facts = build_facts(FAULTS["cart-add-500"]["request"])
    out = AnalysisOut.model_validate(
        {
            "severity": "HIGH",
            "affectedFeatures": [],
            "rootCauses": [
                {"description": f"후보 {i}", "evidenceIds": ["E1"], "confidencePct": 60, "remediation": None}
                for i in range(7)
            ]
            + [{"description": "없는 근거", "evidenceIds": ["E99"], "confidencePct": 99, "remediation": None}],
        }
    )
    causes = ground_and_rank(out, facts)
    assert len(causes) == 5 and [c["rank"] for c in causes] == [1, 2, 3, 4, 5]
    assert sum(c["confidencePct"] for c in causes) <= 100
    assert all(c["description"] != "없는 근거" for c in causes)
