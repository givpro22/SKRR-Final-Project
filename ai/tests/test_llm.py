from __future__ import annotations

import asyncio
import math

import pytest
from pydantic import BaseModel

from app.core.config import Settings
from app.llm.client import (
    LLMConfigError,
    LLMOutputInvalidError,
    LLMTimeoutError,
    LLMTransientError,
    LLMUnavailableError,
    ModelT,
    ResilientLLMClient,
)
from app.llm.factory import build_llm_client
from app.llm.fake import FakeLLMClient, hash_embedding


class Answer(BaseModel):
    value: int


async def test_fake_embedding_is_deterministic_and_normalized() -> None:
    client = FakeLLMClient(dim=64)
    a1, a2, b = await client.embed(["장바구니 담기", "장바구니 담기", "주문 생성"])
    assert a1 == a2
    assert a1 != b
    assert math.isclose(sum(v * v for v in a1), 1.0, rel_tol=1e-9)
    assert hash_embedding("", 8)[0] > 0  # 빈 문자열도 0 벡터가 아니다


async def test_fake_generate_json() -> None:
    client = FakeLLMClient()
    client.register(Answer, {"value": 3})
    out = await client.generate_json(system="s", user="u", schema=Answer)
    assert out.value == 3
    assert client.calls[0].schema == "Answer"

    client.register(Answer, lambda system, user: {"value": len(user)})
    assert (await client.generate_json(system="s", user="abcd", schema=Answer)).value == 4

    client.register(Answer, {"value": "x"})
    with pytest.raises(LLMOutputInvalidError):
        await client.generate_json(system="s", user="u", schema=Answer)

    with pytest.raises(LLMOutputInvalidError):
        await FakeLLMClient().generate_json(system="s", user="u", schema=Answer)


class FlakyClient(FakeLLMClient):
    def __init__(self, failures: int, exc: Exception, delay: float = 0.0) -> None:
        super().__init__(dim=4)
        self.failures = failures
        self.exc = exc
        self.delay = delay
        self.attempts = 0

    async def generate_json(self, *, system: str, user: str, schema: type[ModelT]) -> ModelT:
        self.attempts += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.attempts <= self.failures:
            raise self.exc
        return schema.model_validate({"value": self.attempts})


def _resilient(inner: FakeLLMClient, timeout: float = 5.0) -> ResilientLLMClient:
    return ResilientLLMClient(inner, timeout_seconds=timeout, max_retries=3, backoff_min=0, backoff_max=0)


async def test_retry_then_success() -> None:
    inner = FlakyClient(2, LLMTransientError("503"))
    out = await _resilient(inner).generate_json(system="", user="", schema=Answer)
    assert out.value == 3 and inner.attempts == 3


async def test_retry_exhausted_is_retryable_unavailable() -> None:
    inner = FlakyClient(10, LLMTransientError("503"))
    with pytest.raises(LLMUnavailableError) as err:
        await _resilient(inner).generate_json(system="", user="", schema=Answer)
    assert inner.attempts == 4  # 첫 시도 + 재시도 3회
    assert err.value.retryable and err.value.code == "LLM_UNAVAILABLE"


async def test_timeout_is_retried_then_reported() -> None:
    inner = FlakyClient(0, LLMTransientError("unused"), delay=0.2)
    with pytest.raises(LLMTimeoutError) as err:
        await _resilient(inner, timeout=0.01).generate_json(system="", user="", schema=Answer)
    assert inner.attempts == 4
    assert err.value.code == "LLM_TIMEOUT" and err.value.retryable


async def test_schema_violation_is_not_retried() -> None:
    inner = FlakyClient(10, LLMOutputInvalidError("bad"))
    with pytest.raises(LLMOutputInvalidError):
        await _resilient(inner).generate_json(system="", user="", schema=Answer)
    assert inner.attempts == 1


def test_factory() -> None:
    client = build_llm_client(Settings(LLM_PROVIDER="fake", FAKE_EMBEDDING_DIM=16))
    assert client.provider == "fake"
    assert client.embedding_model == "fake-hash-16"
    with pytest.raises(LLMConfigError):
        build_llm_client(Settings(LLM_PROVIDER="openai"))
