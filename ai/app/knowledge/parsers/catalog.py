"""카탈로그(JSON·CSV) 파서: 화면(page) 1개 = 청크 1개. 형식은 target-site-contract.md."""

from __future__ import annotations

import csv
import io
import json
import re
from collections import OrderedDict
from typing import Any

from app.knowledge.models import Chunk, DocumentParseError, DocumentType, ParsedDocument, UiElement
from app.knowledge.parsers.text_extract import decode_text, detect_format

COMMON_PAGE = "(공통)"
MAX_ELEMENTS_PER_CHUNK = 30
_TEST_ID = re.compile(r"^\S+$")


def _refs(value: Any, location: str) -> tuple[str, ...]:
    if value is None or value == "":
        return ()
    if isinstance(value, str):
        return tuple(r.strip() for r in value.split(";") if r.strip())
    if isinstance(value, list) and all(isinstance(v, str) for v in value):
        return tuple(v.strip() for v in value if v.strip())
    raise DocumentParseError("requirementRefs는 문자열 배열이어야 해요", location)


def _element(raw: dict[str, Any], location: str) -> UiElement:
    test_id = str(raw.get("testId") or "").strip()
    if not test_id:
        raise DocumentParseError("testId가 비어 있어요", location)
    if not _TEST_ID.match(test_id):
        raise DocumentParseError(f"testId '{test_id}'에 공백이 있어요", location)
    return UiElement(
        test_id=test_id,
        page=str(raw.get("page") or "").strip() or COMMON_PAGE,
        label=str(raw.get("label") or "").strip(),
        element_type=str(raw.get("type") or "").strip(),
        requirement_refs=_refs(raw.get("requirementRefs"), location),
    )


def _from_json(data: bytes) -> list[UiElement]:
    try:
        loaded = json.loads(decode_text(data))
    except json.JSONDecodeError as exc:
        raise DocumentParseError("JSON 문법 오류가 있어요", f"줄 {exc.lineno}") from exc
    if not isinstance(loaded, dict) or not isinstance(loaded.get("elements"), list):
        raise DocumentParseError('최상위에 "elements" 배열이 있어야 해요', "문서 최상위")
    elements = []
    for i, raw in enumerate(loaded["elements"]):
        if not isinstance(raw, dict):
            raise DocumentParseError("요소가 객체가 아니에요", f"elements[{i}]")
        elements.append(_element(raw, f"elements[{i}]"))
    return elements


def _from_csv(data: bytes) -> list[UiElement]:
    reader = csv.DictReader(io.StringIO(decode_text(data)))
    if not reader.fieldnames or "testId" not in [f.strip() for f in reader.fieldnames]:
        raise DocumentParseError("머리글에 testId 열이 있어야 해요", "1행")
    elements = []
    # 머리글이 1행이므로 데이터는 2행부터 센다.
    for row_no, row in enumerate(reader, start=2):
        cleaned = {(k or "").strip(): (v or "").strip() for k, v in row.items() if k is not None}
        if not any(cleaned.values()):
            continue
        elements.append(_element(cleaned, f"{row_no}행"))
    return elements


def parse_catalog(document_id: str, data: bytes, content_type: str, key: str) -> ParsedDocument:
    fmt = detect_format(content_type, key)
    if fmt == "json":
        elements = _from_json(data)
    elif fmt == "csv":
        elements = _from_csv(data)
    else:
        raise DocumentParseError("카탈로그는 JSON 또는 CSV 형식만 읽을 수 있어요")
    if not elements:
        raise DocumentParseError("카탈로그에 요소가 없어요", "문서 전체")

    seen: set[tuple[str, str]] = set()
    pages: OrderedDict[str, list[UiElement]] = OrderedDict()
    for el in elements:
        key_ = (el.test_id, el.page)
        if key_ in seen:
            raise DocumentParseError(f"testId '{el.test_id}'가 같은 화면 '{el.page}'에 두 번 있어요")
        seen.add(key_)
        pages.setdefault(el.page, []).append(el)

    chunks: list[Chunk] = []
    for page, page_elements in pages.items():
        groups = [
            page_elements[i : i + MAX_ELEMENTS_PER_CHUNK] for i in range(0, len(page_elements), MAX_ELEMENTS_PER_CHUNK)
        ]
        for gi, group in enumerate(groups, start=1):
            source_id = page if len(groups) == 1 else f"{page} ({gi})"
            lines = [f"화면 {page}"]
            for el in group:
                desc = el.label or el.test_id
                extra = f" [{el.element_type}]" if el.element_type else ""
                refs = f" 관련 요구사항: {', '.join(el.requirement_refs)}" if el.requirement_refs else ""
                lines.append(f"- {el.test_id}: {desc}{extra}{refs}")
            chunks.append(
                Chunk(
                    source_type=DocumentType.CATALOG,
                    source_id=source_id,
                    title=f"{page} 화면 요소",
                    text="\n".join(lines),
                    metadata={"page": page, "testIds": [el.test_id for el in group]},
                )
            )
    return ParsedDocument(document_id, DocumentType.CATALOG, chunks, elements=elements)
