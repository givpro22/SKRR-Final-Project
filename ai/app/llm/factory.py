"""LLM_PROVIDER로 클라이언트를 고른다. 제공자 SDK import는 providers/ 안에서만 한다."""

from __future__ import annotations

from app.core.config import Settings
from app.llm.client import LLMClient, LLMConfigError, ResilientLLMClient
from app.llm.fake_responders import make_fake_llm


def build_llm_client(settings: Settings) -> LLMClient:
    provider = settings.llm_provider.strip().lower()
    inner: LLMClient
    if provider == "fake":
        # 예제 문서에 맞는 결정적 응답기를 등록한 가짜 클라이언트 (app/llm/fake_responders.py)
        inner = make_fake_llm(settings.fake_embedding_dim, delay_seconds=settings.fake_llm_delay_ms / 1000)
    else:
        raise LLMConfigError(
            f"LLM_PROVIDER '{settings.llm_provider}'는 아직 구현되지 않았어요. ADR-010에서 제공자를 정한 뒤 추가해요"
        )
    return ResilientLLMClient(
        inner,
        timeout_seconds=settings.llm_timeout_seconds,
        max_retries=settings.llm_max_retries,
    )
