"""임시 sqlite-vec 파일로 실제 저장·조회를 확인한다."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.knowledge.models import DocumentType, ParsedDocument
from app.knowledge.parsers.api_spec import parse_api_spec
from app.knowledge.parsers.catalog import parse_catalog
from app.knowledge.parsers.requirement import parse_requirement
from app.knowledge.retrieval import EmbeddingModelMismatchError, search
from app.knowledge.store import DocumentInfo, KnowledgeBase, write_knowledge_base
from app.llm.fake import FakeLLMClient


def _parsed(fixtures_dir: Path) -> list[tuple[DocumentInfo, ParsedDocument]]:
    req = parse_requirement("r", (fixtures_dir / "requirements.md").read_bytes(), "text/markdown", "r.md")
    api = parse_api_spec("a", (fixtures_dir / "openapi.yaml").read_bytes())
    cat = parse_catalog("c", (fixtures_dir / "catalog.json").read_bytes(), "application/json", "c.json")
    return [
        (DocumentInfo("r", "REQUIREMENT", 1, "x"), req),
        (DocumentInfo("a", "API_SPEC", 1, "y"), api),
        (DocumentInfo("c", "CATALOG", 2, "z"), cat),
    ]


async def _build(path: Path, fixtures_dir: Path, embedder: FakeLLMClient) -> None:
    docs = _parsed(fixtures_dir)
    texts = [f"{c.source_id} {c.title}\n{c.text}" for _, p in docs for c in p.chunks]
    embeddings = await embedder.embed(texts)
    write_knowledge_base(
        path,
        project_id="p",
        documents=docs,
        embeddings=embeddings,
        embedding_model=embedder.embedding_model,
        tmp_suffix="t",
    )


async def test_store_and_search(tmp_path: Path, fixtures_dir: Path) -> None:
    embedder = FakeLLMClient(dim=256)
    path = tmp_path / "p.sqlite"
    await _build(path, fixtures_dir, embedder)
    assert not list(tmp_path.glob(".*.tmp"))

    with KnowledgeBase(path) as kb:
        assert kb.counts() == {"chunkCount": 11, "requirementCount": 4, "apiCount": 4, "uiElementCount": 6}
        assert kb.meta()["embedding_model"] == "fake-hash-256"
        assert kb.has_requirement("FR-CART-01") and not kb.has_requirement("FR-CART-99")
        assert kb.has_test_id("cart-add-button") and not kb.has_test_id("cart-remove-button")
        op = kb.find_api_operation("get", "/api/cart")
        assert op is not None and op.read_only and op.status_codes == ("200",)
        assert kb.api_specs()[0]["components"]["schemas"]["Cart"]["type"] == "object"

        hits = await search(kb, embedder, "장바구니 수량 변경", k=3)
        assert len(hits) == 3
        assert hits[0].source_id == "FR-CART-02"
        assert all(0.0 <= h.score <= 1.0 for h in hits)
        assert hits[0].score >= hits[1].score >= hits[2].score
        ref = hits[0].to_reference()
        assert set(ref) == {"sourceType", "sourceId", "title", "excerpt", "score"}

        only_api = await search(kb, embedder, "장바구니 조회", k=2, types=[DocumentType.API_SPEC])
        assert [h.source_type for h in only_api] == [DocumentType.API_SPEC] * 2
        assert only_api[0].source_id == "GET /api/cart"


async def test_model_mismatch(tmp_path: Path, fixtures_dir: Path) -> None:
    path = tmp_path / "p.sqlite"
    await _build(path, fixtures_dir, FakeLLMClient(dim=32))
    with KnowledgeBase(path) as kb, pytest.raises(EmbeddingModelMismatchError):
        await search(kb, FakeLLMClient(dim=64), "x")


async def test_failed_write_keeps_previous_index(tmp_path: Path, fixtures_dir: Path) -> None:
    embedder = FakeLLMClient(dim=32)
    path = tmp_path / "p.sqlite"
    await _build(path, fixtures_dir, embedder)
    before = path.read_bytes()
    docs = _parsed(fixtures_dir)
    with pytest.raises(ValueError):
        write_knowledge_base(
            path,
            project_id="p",
            documents=docs,
            embeddings=[[0.1] * 32],
            embedding_model="m",
            tmp_suffix="t2",
        )
    assert path.read_bytes() == before
    assert not list(tmp_path.glob(".*.tmp"))


def test_missing_kb_file(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        KnowledgeBase(tmp_path / "none.sqlite")
