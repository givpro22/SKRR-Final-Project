"""내부 API 라우터 (servers: /internal/v1). operationId는 계약과 같게 둔다."""

from __future__ import annotations

import asyncio
import tempfile
from collections import Counter
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.api.jobs import JobStore, JobType
from app.api.schemas import KnowledgeBaseBuildRequest
from app.core.codes import AiProblemCode
from app.core.config import Settings
from app.core.errors import ApiProblem, problem
from app.knowledge.build import TYPE_LABEL, BuildDocument, KnowledgeBaseBuilder
from app.knowledge.models import INDEXED_TYPES, DocumentType
from app.knowledge.store import check_vector_extension

router = APIRouter(prefix="/internal/v1")


def _jobs(request: Request) -> JobStore:
    store: JobStore = request.app.state.jobs
    return store


@router.get("/healthz", operation_id="aiHealth")
async def ai_health() -> dict[str, str]:
    return {"status": "ok"}


def _kb_dir_writable(settings: Settings) -> str | None:
    try:
        settings.kb_data_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=settings.kb_data_dir, prefix=".ready-", delete=True):
            pass
    except OSError as exc:
        return f"KB_DATA_DIR({settings.kb_data_dir})에 쓸 수 없어요: {type(exc).__name__}"
    return None


@router.get("/readyz", operation_id="aiReady")
async def ai_ready(request: Request) -> JSONResponse:
    settings: Settings = request.app.state.settings
    checks: dict[str, Any] = {}
    ok = True

    dir_error = await asyncio.to_thread(_kb_dir_writable, settings)
    checks["kbDataDir"] = dir_error or "ok"
    ok &= dir_error is None

    try:
        checks["sqliteVec"] = await asyncio.to_thread(check_vector_extension)
    except Exception as exc:
        checks["sqliteVec"] = f"sqlite-vec를 불러오지 못했어요: {type(exc).__name__}"
        ok = False

    llm_error: str | None = request.app.state.llm_error
    checks["llm"] = llm_error or f"{request.app.state.llm.provider} 준비됨"
    ok &= llm_error is None

    return JSONResponse({"status": "ready" if ok else "not_ready", "checks": checks}, status_code=200 if ok else 503)


@router.post("/knowledge-bases/{projectId}/builds", operation_id="startKnowledgeBaseBuild", status_code=202)
async def start_knowledge_base_build(
    projectId: UUID, body: KnowledgeBaseBuildRequest, request: Request
) -> JSONResponse:
    counts = Counter(d.type for d in body.documents)
    missing = [t for t in INDEXED_TYPES if counts[t] == 0]
    if missing:
        raise ApiProblem(
            400,
            "필수 문서가 빠졌어요",
            "빠진 문서: " + ", ".join(TYPE_LABEL[t] for t in missing),
            AiProblemCode.MISSING_REQUIRED_DOCUMENTS,
        )
    duplicated = [t for t, n in counts.items() if n > 1]
    if duplicated:
        raise ApiProblem(
            400,
            "같은 유형의 문서가 두 개 이상이에요",
            "유형마다 활성 문서 하나만 보내 주세요: " + ", ".join(TYPE_LABEL[t] for t in duplicated),
            AiProblemCode.DUPLICATE_DOCUMENT_TYPE,
        )
    builder: KnowledgeBaseBuilder | None = request.app.state.kb_builder
    if builder is None:
        raise ApiProblem(
            503, "임베딩 모델이 준비되지 않았어요", request.app.state.llm_error, AiProblemCode.LLM_NOT_CONFIGURED
        )

    # TEST_DATA는 인덱싱하지 않고 내려받지도 않는다 (값이 AI 서버를 거치지 않게).
    documents = [
        BuildDocument(
            document_id=str(d.documentId),
            doc_type=d.type,
            version=d.version,
            s3_key=d.s3Key,
            content_type=d.contentType,
            checksum_sha256=d.checksumSha256,
        )
        for d in body.documents
        if d.type is not DocumentType.TEST_DATA
    ]
    project_id = str(projectId)
    job = _jobs(request).submit(JobType.KB_BUILD, lambda j: builder.run(j, project_id, documents))
    job.set_progress("QUEUED", 0, "지식 베이스 구축을 시작했어요")
    return JSONResponse(job.to_contract(), status_code=202)


@router.get("/jobs/{jobId}", operation_id="getAiJob")
async def get_ai_job(jobId: str, request: Request) -> JSONResponse:
    job = _jobs(request).get(jobId)
    if job is None:
        return problem(
            404,
            "작업이 없어요",
            "서버가 다시 시작되어 작업이 사라졌을 수 있어요. 다시 요청해 주세요",
            AiProblemCode.JOB_NOT_FOUND,
        )
    return JSONResponse(job.to_contract())


@router.post("/jobs/{jobId}/cancel", operation_id="cancelAiJob", status_code=202)
async def cancel_ai_job(jobId: str, request: Request) -> JSONResponse:
    job = _jobs(request).cancel(jobId)
    if job is None:
        return problem(404, "작업이 없어요", code=AiProblemCode.JOB_NOT_FOUND)
    return JSONResponse(job.to_contract(), status_code=202)
