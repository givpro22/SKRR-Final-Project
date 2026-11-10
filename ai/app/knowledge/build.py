"""지식 베이스 구축 작업 (startKnowledgeBaseBuild, WBS 4.5.1, 4.5.2).

내려받기 → 체크섬 확인 → 유형별 파싱 → 임베딩 → sqlite-vec 저장(임시 파일 후 교체).
문서 하나라도 실패하면 인덱스를 바꾸지 않고, 문서별 상태를 담은 결과와 함께 FAILED로 끝낸다.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import logging
from dataclasses import dataclass
from typing import Any

from app.api.jobs import Job
from app.core.codes import AiErrorCode
from app.core.config import Settings
from app.core.errors import JobFailure
from app.knowledge.models import INDEXED_TYPES, DocumentParseError, DocumentType, ParsedDocument
from app.knowledge.parsers import parse_document
from app.knowledge.sources import DocumentFetchError, DocumentSource
from app.knowledge.store import DocumentInfo, kb_path, write_knowledge_base
from app.llm.client import Embedder

logger = logging.getLogger(__name__)

EMBED_BATCH = 32
SKIPPED_MESSAGE = "다른 문서의 오류로 지식 베이스를 만들지 않았어요"
TYPE_LABEL = {
    DocumentType.REQUIREMENT: "요구사항 명세서",
    DocumentType.API_SPEC: "API 명세서",
    DocumentType.CATALOG: "카탈로그",
    DocumentType.TEST_DATA: "테스트 데이터",
}


@dataclass(frozen=True)
class BuildDocument:
    document_id: str
    doc_type: DocumentType
    version: int
    s3_key: str
    content_type: str
    checksum_sha256: str


@dataclass
class _DocError:
    code: AiErrorCode
    message: str
    retryable: bool


def checksum_matches(data: bytes, expected: str) -> bool:
    """체크섬은 16진수(64자)나 base64(S3 ChecksumSHA256 형식) 둘 다 받는다."""
    digest = hashlib.sha256(data).digest()
    value = expected.strip()
    if value.lower() == digest.hex():
        return True
    try:
        return base64.b64decode(value, validate=True) == digest
    except (binascii.Error, ValueError):
        return False


class KnowledgeBaseBuilder:
    def __init__(self, settings: Settings, source: DocumentSource, embedder: Embedder) -> None:
        self._settings = settings
        self._source = source
        self._embedder = embedder
        self._locks: dict[str, asyncio.Lock] = {}

    def _lock(self, project_id: str) -> asyncio.Lock:
        return self._locks.setdefault(project_id, asyncio.Lock())

    async def run(self, job: Job, project_id: str, documents: list[BuildDocument]) -> dict[str, Any]:
        lock = self._lock(project_id)
        if lock.locked():
            job.set_progress("QUEUED", 0, "같은 프로젝트의 이전 구축이 끝나기를 기다리고 있어요")
        async with lock:
            return await self._build(job, project_id, documents)

    async def _build(self, job: Job, project_id: str, documents: list[BuildDocument]) -> dict[str, Any]:
        targets = [d for d in documents if d.doc_type in INDEXED_TYPES]
        total = len(targets)
        errors: dict[str, _DocError] = {}
        payloads: dict[str, bytes] = {}

        # 1. 내려받기와 체크섬 (0~20%)
        for i, doc in enumerate(targets, start=1):
            job.set_progress("DOWNLOAD", int(20 * (i - 1) / total), f"문서를 내려받고 있어요 ({i}/{total})")
            try:
                data = await self._source.fetch(doc.s3_key, self._settings.max_document_bytes)
            except DocumentFetchError as exc:
                errors[doc.document_id] = _DocError(AiErrorCode.DOCUMENT_DOWNLOAD_FAILED, exc.message, exc.retryable)
                continue
            if not checksum_matches(data, doc.checksum_sha256):
                errors[doc.document_id] = _DocError(
                    AiErrorCode.DOCUMENT_CHECKSUM_MISMATCH,
                    "내려받은 파일의 체크섬이 등록 정보와 달라요. 다시 업로드해 주세요",
                    False,
                )
                continue
            payloads[doc.document_id] = data

        # 2. 파싱 (20~40%)
        parsed: dict[str, ParsedDocument] = {}
        for i, doc in enumerate(targets, start=1):
            if doc.document_id not in payloads:
                continue
            job.set_progress(
                "PARSE", 20 + int(20 * (i - 1) / total), f"{TYPE_LABEL[doc.doc_type]}를 읽고 있어요 ({i}/{total})"
            )
            try:
                parsed[doc.document_id] = await asyncio.to_thread(
                    parse_document,
                    doc.document_id,
                    doc.doc_type,
                    payloads[doc.document_id],
                    doc.content_type,
                    doc.s3_key,
                )
            except DocumentParseError as exc:
                errors[doc.document_id] = _DocError(AiErrorCode.DOCUMENT_PARSE_FAILED, str(exc), False)

        if errors:
            raise self._failure(targets, parsed, errors)

        # 3. 임베딩 (40~90%)
        ordered = [(doc, parsed[doc.document_id]) for doc in targets]
        texts = [_embedding_text(c.source_id, c.title, c.text) for _, p in ordered for c in p.chunks]
        embeddings: list[list[float]] = []
        for start in range(0, len(texts), EMBED_BATCH):
            done = min(start + EMBED_BATCH, len(texts))
            job.set_progress(
                "EMBED", 40 + int(50 * start / len(texts)), f"청크를 임베딩하고 있어요 ({done}/{len(texts)})"
            )
            embeddings.extend(await self._embedder.embed(texts[start:done]))

        # 4. 저장 (90~100%)
        job.set_progress("INDEX", 90, "검색 인덱스를 저장하고 있어요")
        infos = [(DocumentInfo(d.document_id, d.doc_type.value, d.version, d.checksum_sha256), p) for d, p in ordered]
        try:
            await asyncio.to_thread(
                write_knowledge_base,
                kb_path(self._settings.kb_data_dir, project_id),
                project_id=project_id,
                documents=infos,
                embeddings=embeddings,
                embedding_model=self._embedder.embedding_model,
                tmp_suffix=job.job_id,
            )
        except OSError as exc:
            logger.exception("지식 베이스 파일 저장 실패 project=%s", project_id)
            raise JobFailure(
                AiErrorCode.INDEX_WRITE_FAILED,
                f"검색 인덱스 파일을 저장하지 못했어요 ({type(exc).__name__})",
                retryable=True,
            ) from exc

        job.set_progress("INDEX", 100, "지식 베이스를 만들었어요")
        return _result(targets, parsed, {})

    def _failure(
        self,
        targets: list[BuildDocument],
        parsed: dict[str, ParsedDocument],
        errors: dict[str, _DocError],
    ) -> JobFailure:
        by_doc = {d.document_id: d for d in targets}
        codes = {e.code for e in errors.values()}
        code = next(
            c
            for c in (
                AiErrorCode.DOCUMENT_PARSE_FAILED,
                AiErrorCode.DOCUMENT_CHECKSUM_MISMATCH,
                AiErrorCode.DOCUMENT_DOWNLOAD_FAILED,
            )
            if c in codes
        )
        message = " / ".join(f"{TYPE_LABEL[by_doc[d].doc_type]}: {e.message}" for d, e in errors.items())
        return JobFailure(
            code,
            message,
            retryable=all(e.retryable for e in errors.values()),
            result=_result(targets, parsed, errors),
        )


def _embedding_text(source_id: str, title: str, text: str) -> str:
    return f"{source_id} {title}\n{text}"[:4000]


def _result(
    targets: list[BuildDocument], parsed: dict[str, ParsedDocument], errors: dict[str, _DocError]
) -> dict[str, Any]:
    """ai-api.openapi.yaml KnowledgeBaseBuildResult. 실패 시 개수는 0이다 (인덱스를 바꾸지 않았으므로).

    문서별 원인이 없는 작업 전체 오류(임베딩, 인덱스 저장)는 이 결과를 만들지 않고 result를 null로 둔다.
    """
    ok = not errors
    documents: list[dict[str, Any]] = []
    for doc in targets:
        p = parsed.get(doc.document_id)
        entry: dict[str, Any] = {"documentId": doc.document_id}
        if ok and p is not None:
            entry["status"] = "INDEXED"
            entry["summary"] = p.summary()
        else:
            # 이 문서가 원인이면 FAILED, 문제가 없는데 다른 문서 때문에 넣지 않았으면 SKIPPED (ADR-020, D3).
            err = errors.get(doc.document_id)
            entry["status"] = "FAILED" if err else "SKIPPED"
            if p is not None:
                entry["summary"] = p.summary()
            entry["error"] = err.message if err else SKIPPED_MESSAGE
        documents.append(entry)
    all_parsed = list(parsed.values()) if ok else []
    return {
        "kind": "KB_BUILD",
        "chunkCount": sum(len(p.chunks) for p in all_parsed),
        "requirementCount": sum(len(p.requirements) for p in all_parsed),
        "apiCount": sum(len(p.operations) for p in all_parsed),
        "uiElementCount": sum(len(p.elements) for p in all_parsed),
        "documents": documents,
    }
