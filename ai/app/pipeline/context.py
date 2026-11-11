"""생성 작업이 쓰는 지식 베이스 읽기: 파일 열기, 오류 코드 변환, 검색, 가드용 목록.

검색 작업(REQUEST_REFINE, SCENARIO_GENERATE …)은 모두 여기서 지식 베이스를 연다.
평가 스크립트(ai/eval)도 같은 retrieve()를 써서, 잰 수치가 실제 동작과 같게 한다.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.core.codes import AiErrorCode
from app.core.errors import JobFailure
from app.knowledge.models import ApiOperation, DocumentType, Requirement, UiElement
from app.knowledge.retrieval import EmbeddingModelMismatchError, RetrievedChunk, search, search_by_vector
from app.knowledge.store import KnowledgeBase, kb_path
from app.llm.client import Embedder
from app.pipeline.openapi import server_base_path

MAX_VEC_K = 4096


def open_knowledge_base(data_dir: Path, project_id: str) -> KnowledgeBase:
    try:
        return KnowledgeBase(kb_path(data_dir, project_id))
    except FileNotFoundError as exc:
        raise JobFailure(
            AiErrorCode.KNOWLEDGE_BASE_MISSING,
            "지식 베이스가 없어요. 문서 등록 화면에서 지식 베이스를 먼저 구축해 주세요",
            retryable=False,
        ) from exc


def _mismatch(exc: EmbeddingModelMismatchError) -> JobFailure:
    return JobFailure(AiErrorCode.EMBEDDING_MODEL_MISMATCH, str(exc), retryable=False)


async def retrieve(
    kb: KnowledgeBase,
    embedder: Embedder,
    text: str,
    *,
    k: int,
    types: Sequence[DocumentType] | None = None,
) -> list[RetrievedChunk]:
    """요청 문장으로 상위 k개 청크를 찾는다 (FR-02 평가 대상과 같은 함수)."""
    try:
        return await search(kb, embedder, text, k=k, types=types)
    except EmbeddingModelMismatchError as exc:
        raise _mismatch(exc) from exc


async def query_vector(kb: KnowledgeBase, embedder: Embedder, text: str) -> list[float]:
    built_with = kb.meta().get("embedding_model")
    if built_with != embedder.embedding_model:
        raise _mismatch(
            EmbeddingModelMismatchError(
                f"지식 베이스는 {built_with}로 만들었는데 지금 임베딩 모델은 {embedder.embedding_model}이에요. "
                "다시 구축해 주세요"
            )
        )
    [vector] = await embedder.embed([text])
    return vector


_PATH_PARAM = re.compile(r"\{[^/{}]+\}|:[A-Za-z_][A-Za-z0-9_]*")


def _path_regex(template: str) -> re.Pattern[str]:
    parts = _PATH_PARAM.split(template)
    params = _PATH_PARAM.findall(template)
    pattern = ""
    for i, part in enumerate(parts):
        pattern += re.escape(part)
        if i < len(params):
            pattern += r"[^/]+"
    return re.compile(f"^{pattern}/?$")


@dataclass
class Catalog:
    """가드와 근거 연결에 쓰는 정확한 목록. 지식 베이스에서 한 번 읽어 둔다."""

    requirements: dict[str, Requirement]
    operations: list[ApiOperation]
    elements: list[UiElement]
    chunk_rows: list[dict[str, Any]]
    # API 명세 원본(첫 번째)과 서버 경로(servers[0].url의 경로, 예 /api)
    spec: dict[str, Any] = field(default_factory=dict)
    api_base_path: str = ""
    _op_patterns: list[tuple[ApiOperation, re.Pattern[str]]] = field(default_factory=list, repr=False)

    def __post_init__(self) -> None:
        self._op_patterns = [(op, _path_regex(op.path)) for op in self.operations]

    @classmethod
    def load(cls, kb: KnowledgeBase) -> Catalog:
        rows = [
            {
                "sourceType": r["doc_type"],
                "sourceId": r["source_id"],
                "title": r["title"],
                "text": r["text"],
                "metadata": json.loads(r["metadata"]),
            }
            for r in kb.iter_chunks()
        ]
        specs = kb.api_specs()
        spec = specs[0] if specs else {}
        return cls(
            requirements={r.requirement_id: r for r in kb.requirements()},
            operations=kb.api_operations(),
            elements=kb.ui_elements(),
            chunk_rows=rows,
            spec=spec,
            api_base_path=server_base_path(spec),
        )

    @property
    def test_ids(self) -> set[str]:
        return {e.test_id for e in self.elements}

    def find_operation(self, method: str, path: str) -> ApiOperation | None:
        """명세 경로 템플릿(/products/{id})과 실제 경로(/products/1001) 모두 찾는다."""
        method = method.upper()
        for op, pattern in self._op_patterns:
            if op.method == method and (op.path == path or pattern.match(path)):
                return op
        return None

    def request_path(self, op: ApiOperation) -> str:
        """실제 요청 경로 = 서버 경로 + 명세 경로 (예 /api + /cart/items)."""
        return f"{self.api_base_path}{op.path}"

    def match_request(self, method: str, request_path: str) -> ApiOperation | None:
        """실제 요청 경로(서버 경로 포함, {{변수}} 허용)로 명세 작업을 찾는다. 쿼리 문자열은 무시한다."""
        path = request_path.split("?", 1)[0]
        base = self.api_base_path
        if base and (path == base or path.startswith(base + "/")):
            found = self.find_operation(method, path[len(base) :] or "/")
            if found:
                return found
        return self.find_operation(method, path)

    def requirement_text(self, requirement_id: str) -> str:
        for row in self.chunk_rows:
            if row["sourceType"] == DocumentType.REQUIREMENT.value and row["sourceId"] == requirement_id:
                return str(row["text"])
        return ""

    def chunk_for(self, source_type: DocumentType, source_id: str) -> dict[str, Any] | None:
        for row in self.chunk_rows:
            if row["sourceType"] == source_type.value and row["sourceId"] == source_id:
                return row
        return None

    def catalog_chunk_for_test_id(self, test_id: str) -> dict[str, Any] | None:
        for row in self.chunk_rows:
            if row["sourceType"] == DocumentType.CATALOG.value and test_id in row["metadata"].get("testIds", []):
                return row
        return None

    def elements_for_requirement(self, requirement_id: str) -> list[UiElement]:
        return [e for e in self.elements if requirement_id in e.requirement_refs]


def score_all(kb: KnowledgeBase, vector: Sequence[float]) -> dict[tuple[str, str], float]:
    """모든 청크의 요청 대비 유사도. 근거(Reference)의 score로 쓴다."""
    total = kb.counts()["chunkCount"]
    hits = search_by_vector(kb, vector, k=max(1, min(total, MAX_VEC_K)))
    return {(h.source_type.value, h.source_id): h.score for h in hits}
