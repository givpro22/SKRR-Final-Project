"""코드의 오류 코드 enum이 계약(ai-api.openapi.yaml)의 enum과 같은지 확인한다."""

from __future__ import annotations

import yaml

from app.core.codes import AiErrorCode, AiProblemCode, GuardFailureKind
from tests.conftest import CONTRACTS


def _enum(name: str) -> set[str]:
    spec = yaml.safe_load((CONTRACTS / "ai-api.openapi.yaml").read_text(encoding="utf-8"))
    return set(spec["components"]["schemas"][name]["enum"])


def test_error_codes_match_contract() -> None:
    assert {c.value for c in AiErrorCode} == _enum("AiErrorCode")


def test_problem_codes_match_contract() -> None:
    assert {c.value for c in AiProblemCode} == _enum("AiProblemCode")


def test_guard_failure_kinds_match_contract() -> None:
    assert {c.value for c in GuardFailureKind} == _enum("GuardFailureKind")
