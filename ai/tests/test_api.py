"""FastAPI 내부 API. 응답은 계약(ai-api.openapi.yaml) 스키마와 대조한다."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import shutil
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.core.config import Settings
from app.knowledge.sources import LocalDocumentSource
from app.knowledge.store import KnowledgeBase, kb_path
from app.llm.fake import FakeLLMClient
from app.main import create_app
from tests.conftest import ContractValidator, sha256_hex

PROJECT = str(uuid.uuid4())


@pytest.fixture
def docs_dir(tmp_path: Path, fixtures_dir: Path) -> Path:
    root = tmp_path / "s3"
    for folder, name in (
        ("requirements", "requirements.md"),
        ("api-specs", "openapi.yaml"),
        ("catalog", "catalog.json"),
    ):
        (root / folder / PROJECT).mkdir(parents=True)
        shutil.copy(fixtures_dir / name, root / folder / PROJECT / f"u_{name}")
    return root


@pytest.fixture
def settings(tmp_path: Path, docs_dir: Path) -> Settings:
    return Settings(KB_DATA_DIR=tmp_path / "kb", DOCUMENT_SOURCE_DIR=docs_dir, LLM_PROVIDER="fake")


@pytest.fixture
async def client(settings: Settings, docs_dir: Path) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(settings, llm=FakeLLMClient(dim=64), document_source=LocalDocumentSource(docs_dir))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://ai") as c:
        yield c
    await app.state.jobs.shutdown()


def _doc(docs_dir: Path, folder: str, name: str, doc_type: str, content_type: str, **override: Any) -> dict[str, Any]:
    key = f"{folder}/{PROJECT}/u_{name}"
    data = (docs_dir / key).read_bytes()
    body = {
        "documentId": str(uuid.uuid4()),
        "type": doc_type,
        "version": 1,
        "s3Key": key,
        "contentType": content_type,
        "checksumSha256": sha256_hex(data),
    }
    body.update(override)
    return body


def _all_docs(docs_dir: Path) -> list[dict[str, Any]]:
    return [
        _doc(docs_dir, "requirements", "requirements.md", "REQUIREMENT", "text/markdown"),
        _doc(docs_dir, "api-specs", "openapi.yaml", "API_SPEC", "application/yaml"),
        _doc(docs_dir, "catalog", "catalog.json", "CATALOG", "application/json"),
    ]


async def _wait(client: httpx.AsyncClient, job_id: str) -> dict[str, Any]:
    for _ in range(200):
        res = await client.get(f"/internal/v1/jobs/{job_id}")
        body: dict[str, Any] = res.json()
        if body["status"] in {"SUCCEEDED", "FAILED", "CANCELLED"}:
            return body
        await asyncio.sleep(0.02)
    raise AssertionError("작업이 끝나지 않음")


async def test_health(client: httpx.AsyncClient) -> None:
    res = await client.get("/internal/v1/healthz")
    assert res.status_code == 200


async def test_ready(client: httpx.AsyncClient) -> None:
    res = await client.get("/internal/v1/readyz")
    assert res.status_code == 200, res.text
    assert res.json()["checks"]["sqliteVec"].startswith("v")


async def test_not_ready_when_kb_dir_unwritable(tmp_path: Path) -> None:
    blocker = tmp_path / "file"
    blocker.write_text("x")
    app = create_app(Settings(KB_DATA_DIR=blocker / "kb"), llm=FakeLLMClient())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as c:
        res = await c.get("/internal/v1/readyz")
    assert res.status_code == 503
    assert res.json()["checks"]["kbDataDir"] != "ok"


async def test_not_ready_when_llm_provider_unknown(tmp_path: Path) -> None:
    app = create_app(Settings(KB_DATA_DIR=tmp_path, LLM_PROVIDER="unknown"))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as c:
        res = await c.get("/internal/v1/readyz")
        assert res.status_code == 503
        assert "ADR-010" in res.json()["checks"]["llm"]


async def test_build_succeeds(
    client: httpx.AsyncClient, settings: Settings, docs_dir: Path, contract: ContractValidator
) -> None:
    docs = _all_docs(docs_dir)
    contract.validate("KnowledgeBaseBuildRequest", {"documents": docs})
    # TEST_DATA는 받아도 내려받지 않고 결과에도 넣지 않는다 (없는 키여도 실패하지 않음).
    docs.append({**docs[0], "documentId": str(uuid.uuid4()), "type": "TEST_DATA", "s3Key": "test-data/none.json"})
    res = await client.post(f"/internal/v1/knowledge-bases/{PROJECT}/builds", json={"documents": docs})
    assert res.status_code == 202, res.text
    accepted = res.json()
    contract.validate("Job", accepted)
    assert accepted["type"] == "KB_BUILD" and accepted["status"] in {"QUEUED", "RUNNING"}

    job = await _wait(client, accepted["jobId"])
    contract.validate("Job", job)
    contract.validate("KnowledgeBaseBuildResult", job["result"])
    assert job["status"] == "SUCCEEDED", job
    assert job["error"] is None
    assert job["progress"]["percent"] == 100
    result = job["result"]
    assert (result["chunkCount"], result["requirementCount"], result["apiCount"], result["uiElementCount"]) == (
        11,
        4,
        4,
        6,
    )
    by_id = {d["documentId"]: d for d in result["documents"]}
    assert len(by_id) == 3
    assert by_id[docs[0]["documentId"]] == {
        "documentId": docs[0]["documentId"],
        "status": "INDEXED",
        "summary": {"requirementCount": 4},
    }
    assert by_id[docs[1]["documentId"]]["summary"] == {"endpointCount": 4}
    assert by_id[docs[2]["documentId"]]["summary"] == {"elementCount": 6, "pageCount": 3}

    with KnowledgeBase(kb_path(settings.kb_data_dir, PROJECT)) as kb:
        assert kb.counts()["chunkCount"] == 11


async def test_build_accepts_base64_checksum(client: httpx.AsyncClient, docs_dir: Path) -> None:
    docs = _all_docs(docs_dir)
    data = (docs_dir / docs[0]["s3Key"]).read_bytes()
    docs[0]["checksumSha256"] = base64.b64encode(hashlib.sha256(data).digest()).decode()
    res = await client.post(f"/internal/v1/knowledge-bases/{PROJECT}/builds", json={"documents": docs})
    job = await _wait(client, res.json()["jobId"])
    assert job["status"] == "SUCCEEDED"


async def test_parse_failure_keeps_previous_index(
    client: httpx.AsyncClient, settings: Settings, docs_dir: Path, contract: ContractValidator
) -> None:
    ok = await client.post(f"/internal/v1/knowledge-bases/{PROJECT}/builds", json={"documents": _all_docs(docs_dir)})
    assert (await _wait(client, ok.json()["jobId"]))["status"] == "SUCCEEDED"
    before = kb_path(settings.kb_data_dir, PROJECT).read_bytes()

    bad = docs_dir / "requirements" / PROJECT / "u_bad.md"
    bad.write_text("ID가 없는 요구사항 문서\n장바구니에 담는다.\n", encoding="utf-8")
    docs = _all_docs(docs_dir)
    docs[0] = _doc(docs_dir, "requirements", "bad.md", "REQUIREMENT", "text/markdown")
    res = await client.post(f"/internal/v1/knowledge-bases/{PROJECT}/builds", json={"documents": docs})
    job = await _wait(client, res.json()["jobId"])
    contract.validate("Job", job)
    assert job["status"] == "FAILED"
    assert job["error"]["code"] == "DOCUMENT_PARSE_FAILED"
    assert job["error"]["retryable"] is False
    assert "요구사항 명세서: 문서 전체: 요구사항 ID를 찾지 못했어요" in job["error"]["message"]
    statuses = [d["status"] for d in job["result"]["documents"]]
    assert statuses == ["FAILED", "SKIPPED", "SKIPPED"]
    assert job["result"]["documents"][1]["error"] == "다른 문서의 오류로 지식 베이스를 만들지 않았어요"
    # 파싱까지 끝난 SKIPPED 문서는 summary를 함께 준다.
    assert job["result"]["documents"][1]["summary"] == {"endpointCount": 4}
    assert "summary" not in job["result"]["documents"][0]
    assert job["result"]["chunkCount"] == 0
    assert kb_path(settings.kb_data_dir, PROJECT).read_bytes() == before


async def test_checksum_and_download_failures(client: httpx.AsyncClient, docs_dir: Path) -> None:
    docs = _all_docs(docs_dir)
    docs[1]["checksumSha256"] = "0" * 64
    docs[2]["s3Key"] = f"catalog/{PROJECT}/missing.json"
    res = await client.post(f"/internal/v1/knowledge-bases/{PROJECT}/builds", json={"documents": docs})
    job = await _wait(client, res.json()["jobId"])
    assert job["status"] == "FAILED"
    assert job["error"]["code"] == "DOCUMENT_CHECKSUM_MISMATCH"
    errors = [d.get("error", "") for d in job["result"]["documents"]]
    assert "체크섬" in errors[1]
    assert "찾지 못했어요" in errors[2]
    assert [d["status"] for d in job["result"]["documents"]] == ["SKIPPED", "FAILED", "FAILED"]


async def test_path_traversal_is_rejected(client: httpx.AsyncClient, docs_dir: Path) -> None:
    docs = _all_docs(docs_dir)
    docs[2]["s3Key"] = "../../etc/passwd"
    res = await client.post(f"/internal/v1/knowledge-bases/{PROJECT}/builds", json={"documents": docs})
    job = await _wait(client, res.json()["jobId"])
    assert job["result"]["documents"][2]["error"] == "허용되지 않은 문서 경로예요"


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (lambda d: [*d[:2], {**d[0], "documentId": str(uuid.uuid4())}], "MISSING_REQUIRED_DOCUMENTS"),
        (lambda d: [*d, {**d[0], "documentId": str(uuid.uuid4())}], "DUPLICATE_DOCUMENT_TYPE"),
        (lambda d: d[:2], "INVALID_REQUEST"),
        (lambda d: [{**d[0], "documentId": "not-uuid"}, *d[1:]], "INVALID_REQUEST"),
    ],
)
async def test_build_bad_request(
    client: httpx.AsyncClient, docs_dir: Path, mutate: Any, code: str, contract: ContractValidator
) -> None:
    res = await client.post(
        f"/internal/v1/knowledge-bases/{PROJECT}/builds", json={"documents": mutate(_all_docs(docs_dir))}
    )
    assert res.status_code == 400
    assert res.headers["content-type"].startswith("application/problem+json")
    body = res.json()
    assert body["status"] == 400 and body["code"] == code and body["title"]
    contract.validate("Problem", body)


async def test_build_bad_project_id(client: httpx.AsyncClient, docs_dir: Path) -> None:
    res = await client.post("/internal/v1/knowledge-bases/abc/builds", json={"documents": _all_docs(docs_dir)})
    assert res.status_code == 400


async def test_job_not_found(client: httpx.AsyncClient, contract: ContractValidator) -> None:
    res = await client.get("/internal/v1/jobs/nope")
    assert res.status_code == 404
    assert res.json()["code"] == "JOB_NOT_FOUND"
    contract.validate("Problem", res.json())
    cancel = await client.post("/internal/v1/jobs/nope/cancel")
    assert cancel.status_code == 404
    contract.validate("Problem", cancel.json())


async def test_build_without_llm_is_503(tmp_path: Path, docs_dir: Path, contract: ContractValidator) -> None:
    app = create_app(Settings(KB_DATA_DIR=tmp_path, LLM_PROVIDER="unknown"))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as c:
        res = await c.post(f"/internal/v1/knowledge-bases/{PROJECT}/builds", json={"documents": _all_docs(docs_dir)})
    assert res.status_code == 503
    assert res.headers["content-type"].startswith("application/problem+json")
    assert res.json()["code"] == "LLM_NOT_CONFIGURED"
    contract.validate("Problem", res.json())


class SlowEmbedder(FakeLLMClient):
    async def embed(self, texts: list[str]) -> list[list[float]]:
        await asyncio.sleep(10)
        return await super().embed(texts)


async def test_cancel_running_build(settings: Settings, docs_dir: Path) -> None:
    app = create_app(settings, llm=SlowEmbedder(dim=8), document_source=LocalDocumentSource(docs_dir))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as c:
        res = await c.post(f"/internal/v1/knowledge-bases/{PROJECT}/builds", json={"documents": _all_docs(docs_dir)})
        job_id = res.json()["jobId"]
        for _ in range(100):
            if (await c.get(f"/internal/v1/jobs/{job_id}")).json()["progress"].get("phase") == "EMBED":
                break
            await asyncio.sleep(0.01)
        assert (await c.post(f"/internal/v1/jobs/{job_id}/cancel")).status_code == 202
        job = await _wait(c, job_id)
        assert job["status"] == "CANCELLED"
    assert not kb_path(settings.kb_data_dir, PROJECT).exists()


async def test_embedding_failure_is_retryable(settings: Settings, docs_dir: Path, contract: ContractValidator) -> None:
    from app.llm.client import LLMTransientError, ResilientLLMClient

    class Down(FakeLLMClient):
        async def embed(self, texts: list[str]) -> list[list[float]]:
            raise LLMTransientError("503")

    llm = ResilientLLMClient(Down(dim=8), max_retries=1, backoff_min=0, backoff_max=0)
    app = create_app(settings, llm=llm, document_source=LocalDocumentSource(docs_dir))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://ai") as c:
        res = await c.post(f"/internal/v1/knowledge-bases/{PROJECT}/builds", json={"documents": _all_docs(docs_dir)})
        job = await _wait(c, res.json()["jobId"])
    assert job["status"] == "FAILED"
    assert job["error"]["code"] == "LLM_UNAVAILABLE" and job["error"]["retryable"] is True
    # 작업 전체 오류는 문서별 원인이 없으므로 result가 null이다.
    assert job["result"] is None
    contract.validate("Job", job)
