"""런타임 설정. 변수 이름은 docs/architecture.md "런타임 설정" 표를 기준으로 한다."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # ConfigMap·Secret·compose가 넘기는 빈 값(DOCUMENT_SOURCE_DIR= 등)은 설정하지 않은 것으로 본다.
    model_config = SettingsConfigDict(env_file=None, extra="ignore", case_sensitive=False, env_ignore_empty=True)

    # 지식 베이스 (ADR-004)
    kb_data_dir: Path = Field(default=Path("/data/kb"), alias="KB_DATA_DIR")

    # 문서 원본 (S3)
    aws_region: str = Field(default="ap-northeast-2", alias="AWS_REGION")
    s3_bucket: str | None = Field(default=None, alias="S3_BUCKET")
    # MinIO 등 S3 호환 저장소를 쓸 때만 지정한다. 비어 있으면 실제 S3. 이름은 backend와 같다.
    s3_endpoint: str | None = Field(default=None, alias="S3_ENDPOINT")
    s3_path_style: bool = Field(default=False, alias="S3_PATH_STYLE")
    # 개발 전용. 지정하면 S3 대신 {DOCUMENT_SOURCE_DIR}/{s3Key}에서 읽는다.
    # backend STORAGE_TYPE=local의 LOCAL_STORAGE_DIR와 같은 디렉터리를 가리키면 된다.
    document_source_dir: Path | None = Field(default=None, alias="DOCUMENT_SOURCE_DIR")
    max_document_bytes: int = Field(default=20 * 1024 * 1024, alias="MAX_DOCUMENT_BYTES")

    # LLM·임베딩 (ADR-010 미정)
    llm_provider: str = Field(default="fake", alias="LLM_PROVIDER")
    llm_model: str | None = Field(default=None, alias="LLM_MODEL")
    embedding_model: str | None = Field(default=None, alias="EMBEDDING_MODEL")
    llm_api_key: SecretStr | None = Field(default=None, alias="LLM_API_KEY")
    llm_base_url: str | None = Field(default=None, alias="LLM_BASE_URL")
    llm_timeout_seconds: float = Field(default=60.0, alias="LLM_TIMEOUT_SECONDS")
    llm_max_retries: int = Field(default=3, alias="LLM_MAX_RETRIES")
    fake_embedding_dim: int = Field(default=384, alias="FAKE_EMBEDDING_DIM")

    # 작업 저장소 (ADR-007: 프로세스 메모리, 재시작하면 사라짐)
    max_retained_jobs: int = Field(default=500, alias="MAX_RETAINED_JOBS")

    log_level: str = Field(default="INFO", alias="LOG_LEVEL")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
