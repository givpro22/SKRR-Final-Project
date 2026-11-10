"""벡터 검색 (FR-02 요청 정제의 Top K 근거). 결과는 계약의 Reference 형태로 바꾸기 쉽게 둔다."""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import sqlite_vec

from app.knowledge.models import DocumentType
from app.knowledge.store import KnowledgeBase
from app.llm.client import Embedder

EXCERPT_CHARS = 300


class EmbeddingModelMismatchError(Exception):
    """지식 베이스를 만든 임베딩 모델과 지금 모델이 다르다. 재구축이 필요하다."""


@dataclass(frozen=True)
class RetrievedChunk:
    source_type: DocumentType
    source_id: str
    title: str
    excerpt: str
    text: str
    score: float  # 0~1, 코사인 유사도
    metadata: dict[str, Any]

    def to_reference(self) -> dict[str, Any]:
        """ai-api.openapi.yaml의 Reference."""
        return {
            "sourceType": self.source_type.value,
            "sourceId": self.source_id,
            "title": self.title,
            "excerpt": self.excerpt,
            "score": round(self.score, 4),
        }


def _excerpt(text: str) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= EXCERPT_CHARS else flat[: EXCERPT_CHARS - 1] + "…"


def search_by_vector(
    kb: KnowledgeBase,
    vector: Sequence[float],
    *,
    k: int = 3,
    types: Sequence[DocumentType] | None = None,
) -> list[RetrievedChunk]:
    params: list[Any] = [sqlite_vec.serialize_float32(list(vector)), k]
    type_filter = ""
    if types:
        type_filter = f" AND doc_type IN ({', '.join('?' for _ in types)})"
        params.extend(t.value for t in types)
    rows = kb.conn.execute(
        f"""
        SELECT c.doc_type, c.source_id, c.title, c.text, c.metadata, v.distance
        FROM (SELECT chunk_id, distance FROM vec_chunks
              WHERE embedding MATCH ? AND k = ?{type_filter}) v
        JOIN chunks c ON c.id = v.chunk_id
        ORDER BY v.distance
        """,
        params,
    ).fetchall()
    results = []
    for r in rows:
        score = max(0.0, min(1.0, 1.0 - float(r["distance"])))
        results.append(
            RetrievedChunk(
                source_type=DocumentType(r["doc_type"]),
                source_id=r["source_id"],
                title=r["title"],
                excerpt=_excerpt(r["text"]),
                text=r["text"],
                score=score,
                metadata=json.loads(r["metadata"]),
            )
        )
    return results


async def search(
    kb: KnowledgeBase,
    embedder: Embedder,
    query: str,
    *,
    k: int = 3,
    types: Sequence[DocumentType] | None = None,
) -> list[RetrievedChunk]:
    built_with = kb.meta().get("embedding_model")
    if built_with != embedder.embedding_model:
        raise EmbeddingModelMismatchError(
            f"지식 베이스는 {built_with}로 만들었는데 지금 임베딩 모델은 {embedder.embedding_model}이에요. "
            "다시 구축해 주세요"
        )
    [vector] = await embedder.embed([query])
    return search_by_vector(kb, vector, k=k, types=types)
