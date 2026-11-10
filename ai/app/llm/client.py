"""LLM·임베딩 인터페이스 (ADR-010 미정).

파이프라인은 이 모듈의 프로토콜에만 의존하고 특정 SDK를 import하지 않는다.
제공자가 정해지면 providers/에 구현을 추가하고 factory에 등록하면 된다.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Protocol, TypeVar, runtime_checkable

from pydantic import BaseModel
from tenacity import AsyncRetrying, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.core.codes import AiErrorCode

logger = logging.getLogger(__name__)

ModelT = TypeVar("ModelT", bound=BaseModel)
T = TypeVar("T")


class LLMError(Exception):
    """LLM·임베딩 호출 오류. code는 Job.error.code로 그대로 쓴다."""

    code: AiErrorCode = AiErrorCode.LLM_UNAVAILABLE
    retryable = True

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class LLMTransientError(LLMError):
    """네트워크, 429, 5xx처럼 다시 시도하면 될 수 있는 오류. 재시도 대상."""


class LLMUnavailableError(LLMError):
    """재시도를 모두 소진함."""


class LLMTimeoutError(LLMError):
    code = AiErrorCode.LLM_TIMEOUT


class LLMOutputInvalidError(LLMError):
    """스키마 위반 응답. 재시도하지 않고 가드 루프로 넘긴다."""

    code = AiErrorCode.INVALID_LLM_OUTPUT
    retryable = False


class LLMConfigError(LLMError):
    code = AiErrorCode.LLM_NOT_CONFIGURED
    retryable = False


@runtime_checkable
class Embedder(Protocol):
    @property
    def embedding_model(self) -> str: ...

    async def embed(self, texts: list[str]) -> list[list[float]]: ...


@runtime_checkable
class LLMClient(Embedder, Protocol):
    @property
    def provider(self) -> str: ...

    async def generate_json(self, *, system: str, user: str, schema: type[ModelT]) -> ModelT: ...


class ResilientLLMClient:
    """호출마다 시간 제한과 지수 백오프 재시도를 건다 (WBS 4.6.3).

    max_retries=3이면 첫 시도 뒤 최대 3번 더 시도한다. 스키마 위반은 재시도하지 않는다.
    """

    def __init__(
        self,
        inner: LLMClient,
        *,
        timeout_seconds: float = 60.0,
        max_retries: int = 3,
        backoff_min: float = 1.0,
        backoff_max: float = 20.0,
    ) -> None:
        self._inner = inner
        self._timeout = timeout_seconds
        self._max_retries = max_retries
        self._backoff_min = backoff_min
        self._backoff_max = backoff_max

    @property
    def provider(self) -> str:
        return self._inner.provider

    @property
    def embedding_model(self) -> str:
        return self._inner.embedding_model

    async def generate_json(self, *, system: str, user: str, schema: type[ModelT]) -> ModelT:
        return await self._call(lambda: self._inner.generate_json(system=system, user=user, schema=schema))

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return await self._call(lambda: self._inner.embed(texts))

    async def _call(self, fn: Callable[[], Awaitable[T]]) -> T:
        last: Exception | None = None
        retrying = AsyncRetrying(
            stop=stop_after_attempt(self._max_retries + 1),
            wait=wait_exponential(multiplier=self._backoff_min, max=self._backoff_max),
            retry=retry_if_exception_type((LLMTransientError, LLMTimeoutError)),
            reraise=True,
        )
        try:
            async for attempt in retrying:
                with attempt:
                    try:
                        return await asyncio.wait_for(fn(), timeout=self._timeout)
                    except TimeoutError as exc:
                        last = exc
                        raise LLMTimeoutError(f"LLM 응답이 {self._timeout:.0f}초 안에 오지 않았어요") from exc
        except LLMTimeoutError as exc:
            logger.warning("LLM 시간 초과, 재시도 소진")
            raise LLMTimeoutError(
                f"LLM 응답이 {self._timeout:.0f}초 안에 오지 않아 {self._max_retries}번 다시 시도했지만 실패했어요"
            ) from exc
        except LLMTransientError as exc:
            logger.warning("LLM 일시 오류, 재시도 소진: %s", exc.message)
            raise LLMUnavailableError(
                f"LLM 서비스에 연결하지 못해 {self._max_retries}번 다시 시도했지만 실패했어요"
            ) from exc
        raise LLMUnavailableError("LLM 호출이 끝나지 않았어요") from last  # pragma: no cover
