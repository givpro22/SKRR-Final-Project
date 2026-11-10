from __future__ import annotations

from pathlib import Path

import pytest

from app.core.config import Settings
from app.knowledge.sources import (
    LocalDocumentSource,
    S3DocumentSource,
    UnconfiguredDocumentSource,
    build_document_source,
)


def _clear(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("DOCUMENT_SOURCE_DIR", "S3_BUCKET", "S3_ENDPOINT", "S3_PATH_STYLE", "LLM_API_KEY", "LLM_BASE_URL"):
        monkeypatch.delenv(name, raising=False)


def test_empty_env_values_are_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear(monkeypatch)
    for name in ("DOCUMENT_SOURCE_DIR", "LLM_API_KEY", "LLM_BASE_URL", "S3_ENDPOINT"):
        monkeypatch.setenv(name, "")
    monkeypatch.setenv("S3_BUCKET", "docs")
    s = Settings()
    assert s.document_source_dir is None
    assert s.llm_api_key is None and s.llm_base_url is None and s.s3_endpoint is None
    assert isinstance(build_document_source(s), S3DocumentSource)


def test_s3_endpoint_name_matches_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    _clear(monkeypatch)
    monkeypatch.setenv("S3_BUCKET", "docs")
    monkeypatch.setenv("S3_ENDPOINT", "http://minio:9000")
    monkeypatch.setenv("S3_PATH_STYLE", "true")
    s = Settings()
    assert s.s3_endpoint == "http://minio:9000" and s.s3_path_style is True
    client = build_document_source(s)._get_client()  # type: ignore[attr-defined]
    assert client.meta.endpoint_url == "http://minio:9000"
    assert client.meta.config.s3["addressing_style"] == "path"


def test_local_source_wins_and_unconfigured(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _clear(monkeypatch)
    assert isinstance(build_document_source(Settings()), UnconfiguredDocumentSource)
    monkeypatch.setenv("DOCUMENT_SOURCE_DIR", str(tmp_path))
    monkeypatch.setenv("S3_BUCKET", "docs")
    assert isinstance(build_document_source(Settings()), LocalDocumentSource)


async def test_local_source_reads_backend_layout(tmp_path: Path) -> None:
    # backend STORAGE_TYPE=local은 {LOCAL_STORAGE_DIR}/{s3Key}에 저장한다.
    key = "requirements/11111111-2222-4333-8444-555555555555/abc_req.md"
    (tmp_path / key).parent.mkdir(parents=True)
    (tmp_path / key).write_bytes(b"FR-01 x")
    assert await LocalDocumentSource(tmp_path).fetch(key, 100) == b"FR-01 x"
