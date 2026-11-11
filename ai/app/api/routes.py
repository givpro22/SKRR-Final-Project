"""내부 API 라우터 (servers: /internal/v1). operationId는 계약과 같게 둔다."""

from __future__ import annotations

import asyncio
import tempfile
from collections import Counter
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.api.jobs import Job, JobStore, JobType
from app.api.schemas import (
    FailureAnalysisRequest,
    KnowledgeBaseBuildRequest,
    RefinementRequest,
    ScenarioGenerationRequest,
    TestQueryGenerationRequest,
)
from app.core.codes import AiErrorCode, AiProblemCode
from app.core.config import Settings
from app.core.errors import ApiProblem, JobFailure, problem
from app.knowledge.build import TYPE_LABEL, BuildDocument, KnowledgeBaseBuilder
from app.knowledge.models import INDEXED_TYPES, DocumentType
from app.knowledge.store import check_vector_extension
from app.llm.client import LLMClient
from app.pipeline.analysis import AnalysisInput, run_failure_analysis
from app.pipeline.refine import RefinementInput, run_refinement
from app.pipeline.scenario import GenerationInput, Regenerate, ScenarioGenerator
from app.pipeline.testquery import TestQueryInput, run_test_query_generation

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


def _llm_or_failure(request: Request) -> LLMClient:
    """LLM이 설정되지 않았으면 작업을 LLM_NOT_CONFIGURED로 실패시킨다 (이 작업들의 계약 응답은 202·400뿐)."""
    llm: LLMClient | None = request.app.state.llm
    if llm is None:
        raise JobFailure(
            AiErrorCode.LLM_NOT_CONFIGURED,
            request.app.state.llm_error or "LLM이 설정되지 않았어요",
            retryable=False,
        )
    return llm


@router.post("/requests/refinements", operation_id="startRequestRefinement", status_code=202)
async def start_request_refinement(body: RefinementRequest, request: Request) -> JSONResponse:
    settings: Settings = request.app.state.settings
    inp = RefinementInput(
        project_id=str(body.projectId),
        text=body.text,
        candidate_count=body.candidateCount,
        top_k=body.topK,
    )

    async def work(job: Job) -> dict[str, Any]:
        return await run_refinement(job, inp, _llm_or_failure(request), settings.kb_data_dir)

    job = _jobs(request).submit(JobType.REQUEST_REFINE, work)
    job.set_progress("QUEUED", 0, "요청 정제를 시작했어요")
    return JSONResponse(job.to_contract(), status_code=202)


@router.post("/scenarios/generations", operation_id="startScenarioGeneration", status_code=202)
async def start_scenario_generation(body: ScenarioGenerationRequest, request: Request) -> JSONResponse:
    settings: Settings = request.app.state.settings
    regen = body.regenerate
    inp = GenerationInput(
        project_id=str(body.projectId),
        test_request_code=body.testRequestCode,
        request_text=body.requestText,
        first_scenario_number=body.firstScenarioNumber,
        first_case_number=body.firstCaseNumber,
        regenerate=Regenerate(regen.scenarioCode, regen.previous, regen.feedback) if regen else None,
    )

    async def work(job: Job) -> dict[str, Any]:
        return await ScenarioGenerator(_llm_or_failure(request), settings.kb_data_dir).run(job, inp)

    job = _jobs(request).submit(JobType.SCENARIO_GENERATE, work)
    job.set_progress("QUEUED", 0, "시나리오 생성을 시작했어요")
    if regen:
        job.progress.scenario_code = regen.scenarioCode
    return JSONResponse(job.to_contract(), status_code=202)


@router.post("/test-queries/generations", operation_id="startTestQueryGeneration", status_code=202)
async def start_test_query_generation(body: TestQueryGenerationRequest, request: Request) -> JSONResponse:
    settings: Settings = request.app.state.settings
    case = body.testCase.model_dump(exclude_none=True)
    inp = TestQueryInput(
        project_id=str(body.projectId),
        scenario=body.scenario.model_dump(),
        test_case=case,
        available_variables=list(dict.fromkeys(body.availableVariables)),
        previous_error=body.previousError,
        query_api_base_path=(body.queryApiBaseUrl.path or "/") if body.queryApiBaseUrl else None,
    )

    async def work(job: Job) -> dict[str, Any]:
        return await run_test_query_generation(job, inp, _llm_or_failure(request), settings.kb_data_dir)

    job = _jobs(request).submit(JobType.TEST_QUERY_GENERATE, work)
    job.set_progress("QUEUED", 0, f"{body.testCase.code} 실행 정의 생성을 시작했어요")
    return JSONResponse(job.to_contract(), status_code=202)


@router.post("/failure-analyses", operation_id="startFailureAnalysis", status_code=202)
async def start_failure_analysis(body: FailureAnalysisRequest, request: Request) -> JSONResponse:
    settings: Settings = request.app.state.settings
    inp = AnalysisInput(project_id=str(body.projectId), request=body.model_dump(mode="json", exclude_none=True))

    async def work(job: Job) -> dict[str, Any]:
        return await run_failure_analysis(job, inp, _llm_or_failure(request), settings.kb_data_dir)

    job = _jobs(request).submit(JobType.FAILURE_ANALYZE, work)
    job.set_progress("QUEUED", 0, f"{body.caseCode} 실패 원인 분석을 시작했어요")
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
