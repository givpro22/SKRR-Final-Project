"""요구사항 명세서 파서: 요구사항 ID 1개 = 청크 1개."""

from __future__ import annotations

from app.knowledge.chunking import split_requirements
from app.knowledge.models import Chunk, DocumentParseError, DocumentType, ParsedDocument, Requirement
from app.knowledge.parsers.text_extract import detect_format, extract_lines


def parse_requirement(document_id: str, data: bytes, content_type: str, key: str) -> ParsedDocument:
    fmt = detect_format(content_type, key)
    lines = extract_lines(data, fmt)
    if not any(line.text.strip() for line in lines):
        raise DocumentParseError("문서에서 글자를 추출하지 못했어요. 스캔한 이미지 PDF는 읽을 수 없어요", "문서 전체")
    sections = split_requirements(lines)
    if not sections:
        raise DocumentParseError(
            "요구사항 ID를 찾지 못했어요. 각 요구사항을 FR-CART-01처럼 줄 맨 앞의 ID로 시작해 주세요",
            "문서 전체",
        )
    chunks: list[Chunk] = []
    requirements: list[Requirement] = []
    for sec in sections:
        requirements.append(Requirement(sec.requirement_id, sec.title))
        chunks.append(
            Chunk(
                source_type=DocumentType.REQUIREMENT,
                source_id=sec.requirement_id,
                title=sec.title,
                text=sec.text,
                metadata={"location": sec.location},
            )
        )
    return ParsedDocument(document_id, DocumentType.REQUIREMENT, chunks, requirements=requirements)
