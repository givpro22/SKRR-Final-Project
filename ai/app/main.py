"""SKRR AI 서버. 실행: uvicorn app.main:app --host 0.0.0.0 --port 8000"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.jobs import JobStore
from app.api.routes import router
from app.core.config import Settings, get_settings
from app.core.errors import install_error_handlers
from app.core.logging import configure_logging
from app.knowledge.build import KnowledgeBaseBuilder
from app.knowledge.sources import DocumentSource, build_document_source
from app.llm.client import LLMClient, LLMConfigError
from app.llm.factory import build_llm_client

logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    *,
    llm: LLMClient | None = None,
    document_source: DocumentSource | None = None,
) -> FastAPI:
    """테스트에서는 settings, llm, document_source를 주입한다."""
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    llm_error: str | None = None
    if llm is None:
        try:
            llm = build_llm_client(settings)
        except LLMConfigError as exc:
            llm_error = exc.message
            logger.error("LLM 설정 오류: %s", exc.message)
    source = document_source or build_document_source(settings)
    jobs = JobStore(settings.max_retained_jobs)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await jobs.shutdown()

    app = FastAPI(
        title="SKRR AI 서버 내부 API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/internal/v1/docs",
        openapi_url="/internal/v1/openapi.json",
    )
    app.state.settings = settings
    app.state.jobs = jobs
    app.state.llm = llm
    app.state.llm_error = llm_error
    app.state.kb_builder = KnowledgeBaseBuilder(settings, source, llm) if llm is not None else None
    install_error_handlers(app)
    app.include_router(router)
    return app


app = create_app()
