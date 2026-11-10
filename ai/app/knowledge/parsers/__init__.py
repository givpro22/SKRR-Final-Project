"""문서 유형별 파서 선택."""

from __future__ import annotations

from app.knowledge.models import DocumentParseError, DocumentType, ParsedDocument
from app.knowledge.parsers.api_spec import parse_api_spec
from app.knowledge.parsers.catalog import parse_catalog
from app.knowledge.parsers.requirement import parse_requirement
from app.knowledge.parsers.text_extract import detect_format


def parse_document(
    document_id: str, doc_type: DocumentType, data: bytes, content_type: str, key: str
) -> ParsedDocument:
    if doc_type is DocumentType.REQUIREMENT:
        return parse_requirement(document_id, data, content_type, key)
    if doc_type is DocumentType.API_SPEC:
        if detect_format(content_type, key) not in {"yaml", "json", "unknown", "text"}:
            raise DocumentParseError("API 명세서는 OpenAPI YAML 또는 JSON 형식만 읽을 수 있어요")
        return parse_api_spec(document_id, data)
    if doc_type is DocumentType.CATALOG:
        return parse_catalog(document_id, data, content_type, key)
    raise DocumentParseError("테스트 데이터 문서는 지식 베이스에 넣지 않아요")


__all__ = ["parse_document"]
