"""sqlite-vec 지식 베이스 파일 (ADR-004).

파일: {KB_DATA_DIR}/{projectId}.sqlite. 구축은 임시 파일에 한 뒤 os.replace로 교체해,
구축이 실패해도 기존 인덱스가 망가지지 않게 한다.

가드용 목록(요구사항 ID, API 작업, testId)은 벡터와 별개로 정확히 저장한다.
"""

from __future__ import annotations

import contextlib
import json
import os
import sqlite3
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import sqlite_vec

from app.knowledge.models import ApiOperation, Chunk, ParsedDocument, Requirement, UiElement

SCHEMA_VERSION = 1


def connect(path: Path | str) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    conn.row_factory = sqlite3.Row
    return conn


def check_vector_extension() -> str:
    """sqlite-vec를 불러올 수 있는지 확인하고 버전을 돌려준다."""
    with contextlib.closing(connect(":memory:")) as conn:
        row = conn.execute("SELECT vec_version()").fetchone()
        return str(row[0])


def kb_path(data_dir: Path, project_id: str) -> Path:
    return data_dir / f"{project_id}.sqlite"


@dataclass(frozen=True)
class DocumentInfo:
    document_id: str
    doc_type: str
    version: int
    checksum_sha256: str


def _ddl(dim: int) -> list[str]:
    return [
        "CREATE TABLE kb_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        """CREATE TABLE documents (
            document_id TEXT PRIMARY KEY, doc_type TEXT NOT NULL, version INTEGER NOT NULL,
            checksum_sha256 TEXT NOT NULL, summary TEXT NOT NULL)""",
        """CREATE TABLE chunks (
            id INTEGER PRIMARY KEY, document_id TEXT NOT NULL, doc_type TEXT NOT NULL,
            source_id TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, metadata TEXT NOT NULL)""",
        "CREATE INDEX idx_chunks_source ON chunks (doc_type, source_id)",
        f"""CREATE VIRTUAL TABLE vec_chunks USING vec0(
            chunk_id INTEGER PRIMARY KEY, embedding float[{dim}] distance_metric=cosine, doc_type TEXT)""",
        """CREATE TABLE requirements (
            requirement_id TEXT PRIMARY KEY, title TEXT NOT NULL, document_id TEXT NOT NULL)""",
        """CREATE TABLE api_operations (
            method TEXT NOT NULL, path TEXT NOT NULL, operation_id TEXT, summary TEXT,
            read_only INTEGER NOT NULL, status_codes TEXT NOT NULL, security TEXT NOT NULL,
            document_id TEXT NOT NULL, PRIMARY KEY (method, path))""",
        """CREATE TABLE ui_elements (
            test_id TEXT NOT NULL, page TEXT NOT NULL, label TEXT NOT NULL, element_type TEXT NOT NULL,
            requirement_refs TEXT NOT NULL, document_id TEXT NOT NULL, PRIMARY KEY (test_id, page))""",
        "CREATE TABLE api_specs (document_id TEXT PRIMARY KEY, content TEXT NOT NULL)",
    ]


def write_knowledge_base(
    target: Path,
    *,
    project_id: str,
    documents: Sequence[tuple[DocumentInfo, ParsedDocument]],
    embeddings: Sequence[Sequence[float]],
    embedding_model: str,
    tmp_suffix: str,
) -> None:
    """모든 청크와 임베딩을 새 파일에 쓰고 target과 교체한다.

    embeddings는 documents의 청크를 순서대로 이어 붙인 것과 길이가 같아야 한다.
    """
    chunks: list[tuple[DocumentInfo, Chunk]] = [(info, c) for info, parsed in documents for c in parsed.chunks]
    if len(chunks) != len(embeddings):
        raise ValueError("청크 수와 임베딩 수가 다릅니다")
    if not embeddings:
        raise ValueError("저장할 청크가 없습니다")
    dim = len(embeddings[0])
    if any(len(e) != dim for e in embeddings):
        raise ValueError("임베딩 차원이 일정하지 않습니다")

    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f".{target.name}.{tmp_suffix}.tmp")
    tmp.unlink(missing_ok=True)
    try:
        conn = connect(tmp)
        try:
            with conn:
                for stmt in _ddl(dim):
                    conn.execute(stmt)
                meta = {
                    "schema_version": str(SCHEMA_VERSION),
                    "project_id": project_id,
                    "embedding_model": embedding_model,
                    "embedding_dim": str(dim),
                    "built_at": datetime.now(UTC).isoformat(),
                }
                conn.executemany("INSERT INTO kb_meta(key, value) VALUES (?, ?)", meta.items())
                for info, parsed in documents:
                    conn.execute(
                        "INSERT INTO documents VALUES (?, ?, ?, ?, ?)",
                        (
                            info.document_id,
                            info.doc_type,
                            info.version,
                            info.checksum_sha256,
                            json.dumps(parsed.summary()),
                        ),
                    )
                    _insert_guard_rows(conn, info.document_id, parsed)
                for chunk_id, ((info, chunk), emb) in enumerate(zip(chunks, embeddings, strict=True), start=1):
                    conn.execute(
                        "INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (
                            chunk_id,
                            info.document_id,
                            chunk.source_type.value,
                            chunk.source_id,
                            chunk.title,
                            chunk.text,
                            json.dumps(chunk.metadata, ensure_ascii=False),
                        ),
                    )
                    conn.execute(
                        "INSERT INTO vec_chunks(chunk_id, embedding, doc_type) VALUES (?, ?, ?)",
                        (chunk_id, sqlite_vec.serialize_float32(list(emb)), chunk.source_type.value),
                    )
        finally:
            conn.close()
        os.replace(tmp, target)
    finally:
        tmp.unlink(missing_ok=True)


def _insert_guard_rows(conn: sqlite3.Connection, document_id: str, parsed: ParsedDocument) -> None:
    conn.executemany(
        "INSERT OR IGNORE INTO requirements VALUES (?, ?, ?)",
        [(r.requirement_id, r.title, document_id) for r in parsed.requirements],
    )
    conn.executemany(
        "INSERT OR REPLACE INTO api_operations VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                o.method,
                o.path,
                o.operation_id,
                o.summary,
                int(o.read_only),
                json.dumps(list(o.status_codes)),
                json.dumps(list(o.security)),
                document_id,
            )
            for o in parsed.operations
        ],
    )
    conn.executemany(
        "INSERT INTO ui_elements VALUES (?, ?, ?, ?, ?, ?)",
        [
            (e.test_id, e.page, e.label, e.element_type, json.dumps(list(e.requirement_refs)), document_id)
            for e in parsed.elements
        ],
    )
    if parsed.raw_spec is not None:
        conn.execute(
            "INSERT INTO api_specs VALUES (?, ?)",
            (document_id, json.dumps(parsed.raw_spec, ensure_ascii=False)),
        )


class KnowledgeBase:
    """구축된 지식 베이스 읽기. 검색과 가드 조회에 쓴다."""

    def __init__(self, path: Path) -> None:
        if not path.exists():
            raise FileNotFoundError(str(path))
        self._conn = connect(path)

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> KnowledgeBase:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @property
    def conn(self) -> sqlite3.Connection:
        return self._conn

    def meta(self) -> dict[str, str]:
        return {r["key"]: r["value"] for r in self._conn.execute("SELECT key, value FROM kb_meta")}

    def counts(self) -> dict[str, int]:
        def one(sql: str) -> int:
            return int(self._conn.execute(sql).fetchone()[0])

        return {
            "chunkCount": one("SELECT COUNT(*) FROM chunks"),
            "requirementCount": one("SELECT COUNT(*) FROM requirements"),
            "apiCount": one("SELECT COUNT(*) FROM api_operations"),
            "uiElementCount": one("SELECT COUNT(*) FROM ui_elements"),
        }

    # --- 가드 조회 (정확 일치) ---
    def requirements(self) -> list[Requirement]:
        rows = self._conn.execute("SELECT requirement_id, title FROM requirements ORDER BY requirement_id")
        return [Requirement(r["requirement_id"], r["title"]) for r in rows]

    def has_requirement(self, requirement_id: str) -> bool:
        row = self._conn.execute("SELECT 1 FROM requirements WHERE requirement_id = ?", (requirement_id,))
        return row.fetchone() is not None

    def api_operations(self) -> list[ApiOperation]:
        rows = self._conn.execute("SELECT * FROM api_operations ORDER BY path, method")
        return [
            ApiOperation(
                method=r["method"],
                path=r["path"],
                operation_id=r["operation_id"],
                summary=r["summary"],
                read_only=bool(r["read_only"]),
                status_codes=tuple(json.loads(r["status_codes"])),
                security=tuple(json.loads(r["security"])),
            )
            for r in rows
        ]

    def find_api_operation(self, method: str, path: str) -> ApiOperation | None:
        for op in self.api_operations():
            if op.method == method.upper() and op.path == path:
                return op
        return None

    def ui_elements(self) -> list[UiElement]:
        rows = self._conn.execute("SELECT * FROM ui_elements ORDER BY page, test_id")
        return [
            UiElement(
                test_id=r["test_id"],
                page=r["page"],
                label=r["label"],
                element_type=r["element_type"],
                requirement_refs=tuple(json.loads(r["requirement_refs"])),
            )
            for r in rows
        ]

    def has_test_id(self, test_id: str) -> bool:
        row = self._conn.execute("SELECT 1 FROM ui_elements WHERE test_id = ?", (test_id,))
        return row.fetchone() is not None

    def api_specs(self) -> list[dict[str, Any]]:
        rows = self._conn.execute("SELECT content FROM api_specs")
        return [json.loads(r["content"]) for r in rows]

    def iter_chunks(self) -> Iterator[sqlite3.Row]:
        yield from self._conn.execute("SELECT * FROM chunks ORDER BY id")
