"""파싱 결과와 청크. 청크는 ID 단위로 자른다 (요구사항 1개, 엔드포인트 1개, 화면 1개)."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class DocumentType(StrEnum):
    REQUIREMENT = "REQUIREMENT"
    API_SPEC = "API_SPEC"
    CATALOG = "CATALOG"
    TEST_DATA = "TEST_DATA"


INDEXED_TYPES = (DocumentType.REQUIREMENT, DocumentType.API_SPEC, DocumentType.CATALOG)


class DocumentParseError(Exception):
    """문서를 지식 베이스에 넣을 수 없음. location은 사용자가 찾아갈 수 있는 위치다."""

    def __init__(self, message: str, location: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.location = location

    def __str__(self) -> str:
        return f"{self.location}: {self.message}" if self.location else self.message


@dataclass(frozen=True)
class Chunk:
    source_type: DocumentType
    source_id: str  # FR-CART-01, "GET /api/cart", "/cart"
    title: str
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Requirement:
    requirement_id: str
    title: str


@dataclass(frozen=True)
class ApiOperation:
    method: str
    path: str
    operation_id: str | None
    summary: str | None
    read_only: bool
    status_codes: tuple[str, ...]
    security: tuple[str, ...]


@dataclass(frozen=True)
class UiElement:
    test_id: str
    page: str
    label: str
    element_type: str
    requirement_refs: tuple[str, ...]


@dataclass
class ParsedDocument:
    document_id: str
    doc_type: DocumentType
    chunks: list[Chunk]
    requirements: list[Requirement] = field(default_factory=list)
    operations: list[ApiOperation] = field(default_factory=list)
    elements: list[UiElement] = field(default_factory=list)
    # API 명세 원본(JSON 직렬화 가능). TestQuery 후처리에서 응답 스키마를 복사할 때 쓴다 (ADR-014).
    raw_spec: dict[str, Any] | None = None

    def summary(self) -> dict[str, int]:
        if self.doc_type is DocumentType.REQUIREMENT:
            return {"requirementCount": len(self.requirements)}
        if self.doc_type is DocumentType.API_SPEC:
            return {"endpointCount": len(self.operations)}
        if self.doc_type is DocumentType.CATALOG:
            return {"elementCount": len(self.elements), "pageCount": len({e.page for e in self.elements})}
        return {}
