"""문서 원본 읽기. 운영은 S3(boto3, 기본 자격 증명 체인), 개발·테스트는 로컬 디렉터리."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Protocol

from app.core.config import Settings


class DocumentFetchError(Exception):
    def __init__(self, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.message = message
        self.retryable = retryable


class DocumentSource(Protocol):
    async def fetch(self, key: str, max_bytes: int) -> bytes: ...


def _too_large(max_bytes: int) -> DocumentFetchError:
    return DocumentFetchError(f"문서가 {max_bytes // (1024 * 1024)}MB보다 커요", retryable=False)


class LocalDocumentSource:
    """DOCUMENT_SOURCE_DIR 아래에서 s3Key 경로로 읽는다. 디렉터리 밖으로 나가는 경로는 거부한다."""

    def __init__(self, root: Path) -> None:
        self._root = root.resolve()

    async def fetch(self, key: str, max_bytes: int) -> bytes:
        path = (self._root / key).resolve()
        if not path.is_relative_to(self._root):
            raise DocumentFetchError("허용되지 않은 문서 경로예요", retryable=False)
        if not path.is_file():
            raise DocumentFetchError("문서 파일을 찾지 못했어요", retryable=False)
        if path.stat().st_size > max_bytes:
            raise _too_large(max_bytes)
        return await asyncio.to_thread(path.read_bytes)


class S3DocumentSource:
    def __init__(self, bucket: str, region: str, endpoint_url: str | None = None, path_style: bool = False) -> None:
        self._bucket = bucket
        self._region = region
        self._endpoint_url = endpoint_url
        self._path_style = path_style
        self._client: Any = None

    def _get_client(self) -> Any:
        if self._client is None:
            import boto3
            from botocore.config import Config

            config = Config(s3={"addressing_style": "path"}) if self._path_style else None
            self._client = boto3.client(
                "s3", region_name=self._region, endpoint_url=self._endpoint_url or None, config=config
            )
        return self._client

    def _fetch_sync(self, key: str, max_bytes: int) -> bytes:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            obj = self._get_client().get_object(Bucket=self._bucket, Key=key)
            length = obj.get("ContentLength")
            if isinstance(length, int) and length > max_bytes:
                raise _too_large(max_bytes)
            body = obj["Body"].read(max_bytes + 1)
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if code in {"NoSuchKey", "404", "NoSuchBucket"}:
                raise DocumentFetchError("S3에서 문서를 찾지 못했어요", retryable=False) from exc
            if code in {"AccessDenied", "403"}:
                raise DocumentFetchError("S3 문서 읽기 권한이 없어요", retryable=False) from exc
            raise DocumentFetchError(f"S3에서 문서를 내려받지 못했어요 ({code})", retryable=True) from exc
        except BotoCoreError as exc:
            raise DocumentFetchError(f"S3에 연결하지 못했어요 ({type(exc).__name__})", retryable=True) from exc
        if len(body) > max_bytes:
            raise _too_large(max_bytes)
        return bytes(body)

    async def fetch(self, key: str, max_bytes: int) -> bytes:
        return await asyncio.to_thread(self._fetch_sync, key, max_bytes)


class UnconfiguredDocumentSource:
    async def fetch(self, key: str, max_bytes: int) -> bytes:
        raise DocumentFetchError("S3_BUCKET이 설정되지 않아 문서를 읽을 수 없어요", retryable=False)


def build_document_source(settings: Settings) -> DocumentSource:
    if settings.document_source_dir is not None:
        return LocalDocumentSource(settings.document_source_dir)
    if settings.s3_bucket:
        return S3DocumentSource(settings.s3_bucket, settings.aws_region, settings.s3_endpoint, settings.s3_path_style)
    return UnconfiguredDocumentSource()
