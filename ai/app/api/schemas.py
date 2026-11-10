"""계약(docs/contracts/ai-api.openapi.yaml)의 요청 모델. 응답은 Job.to_contract()로 만든다."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.knowledge.models import DocumentType


class KnowledgeBaseDocument(BaseModel):
    model_config = ConfigDict(extra="ignore")

    documentId: UUID
    type: DocumentType
    version: int
    s3Key: Annotated[str, Field(min_length=1)]
    contentType: str
    checksumSha256: Annotated[str, Field(min_length=1)]


class KnowledgeBaseBuildRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    documents: Annotated[list[KnowledgeBaseDocument], Field(min_length=3)]
