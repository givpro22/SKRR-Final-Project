"""결정적인 가짜 LLM 클라이언트. 테스트와 개발에 쓴다 (ADR-010 미정 동안).

- generate_json: 스키마 이름으로 등록한 응답을 돌려준다. 등록하지 않았으면 INVALID_LLM_OUTPUT.
- embed: 단어와 한글 2글자 조각을 해시해 고정 차원 벡터로 만든다. 같은 입력이면 프로세스가 달라도 같다.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ValidationError

from app.llm.client import LLMOutputInvalidError, ModelT

FakeResponse = Mapping[str, Any] | Callable[[str, str], Mapping[str, Any]]

_TOKEN = re.compile(r"[0-9a-z가-힣]+")
_HANGUL = re.compile(r"[가-힣]")


@dataclass
class FakeCall:
    system: str
    user: str
    schema: str


@dataclass
class FakeLLMClient:
    responses: dict[str, FakeResponse] = field(default_factory=dict)
    dim: int = 384
    calls: list[FakeCall] = field(default_factory=list)

    @property
    def provider(self) -> str:
        return "fake"

    @property
    def embedding_model(self) -> str:
        return f"fake-hash-{self.dim}"

    def register(self, schema: type[BaseModel], response: FakeResponse) -> None:
        self.responses[schema.__name__] = response

    async def generate_json(self, *, system: str, user: str, schema: type[ModelT]) -> ModelT:
        self.calls.append(FakeCall(system=system, user=user, schema=schema.__name__))
        response = self.responses.get(schema.__name__)
        if response is None:
            raise LLMOutputInvalidError(f"가짜 클라이언트에 {schema.__name__} 응답이 등록되지 않았어요")
        data = response(system, user) if callable(response) else response
        try:
            return schema.model_validate(data)
        except ValidationError as exc:
            raise LLMOutputInvalidError(f"응답이 {schema.__name__} 스키마와 맞지 않아요: {exc}") from exc

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [hash_embedding(t, self.dim) for t in texts]


def _features(text: str) -> list[str]:
    feats: list[str] = []
    for tok in _TOKEN.findall(text.lower()):
        feats.append(tok)
        if _HANGUL.search(tok) and len(tok) > 1:
            feats.extend(tok[i : i + 2] for i in range(len(tok) - 1))
    return feats


def hash_embedding(text: str, dim: int) -> list[float]:
    vec = [0.0] * dim
    # 빈 입력에서도 코사인 거리가 정의되도록 상수 성분을 둔다.
    vec[0] = 0.01
    for feat in _features(text):
        digest = hashlib.blake2b(feat.encode("utf-8"), digest_size=8).digest()
        value = int.from_bytes(digest, "big")
        idx = value % dim
        sign = 1.0 if (value >> 63) & 1 else -1.0
        vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec))
    return [v / norm for v in vec]
