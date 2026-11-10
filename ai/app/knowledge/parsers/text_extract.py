"""PDF·DOCX·텍스트에서 위치 정보가 붙은 줄을 뽑는다."""

from __future__ import annotations

import io
from dataclasses import dataclass

from app.knowledge.models import DocumentParseError

PDF_TYPES = {"application/pdf"}
DOCX_TYPES = {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
TEXT_TYPES = {"text/plain", "text/markdown", "text/x-markdown"}


@dataclass(frozen=True)
class Line:
    text: str
    location: str  # "3쪽", "문단 12", "표 1 2행", "줄 40"


def detect_format(content_type: str, key: str) -> str:
    ct = content_type.split(";")[0].strip().lower()
    lower = key.lower()
    if ct in PDF_TYPES or lower.endswith(".pdf"):
        return "pdf"
    if ct in DOCX_TYPES or lower.endswith(".docx"):
        return "docx"
    if ct in TEXT_TYPES or lower.endswith((".md", ".markdown", ".txt")):
        return "text"
    if ct in {"application/json"} or lower.endswith(".json"):
        return "json"
    if ct in {"application/yaml", "application/x-yaml", "text/yaml", "text/x-yaml"} or lower.endswith(
        (".yaml", ".yml")
    ):
        return "yaml"
    if ct in {"text/csv", "application/csv"} or lower.endswith(".csv"):
        return "csv"
    return "unknown"


def decode_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp949"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise DocumentParseError("문자 인코딩을 읽지 못했어요. UTF-8로 저장해 주세요")


def extract_lines(data: bytes, fmt: str) -> list[Line]:
    if fmt == "pdf":
        return _pdf_lines(data)
    if fmt == "docx":
        return _docx_lines(data)
    if fmt == "text":
        return [Line(t, f"줄 {i}") for i, t in enumerate(decode_text(data).splitlines(), start=1)]
    raise DocumentParseError("요구사항 명세서는 PDF, DOCX, 텍스트(MD, TXT) 형식만 읽을 수 있어요")


def _pdf_lines(data: bytes) -> list[Line]:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(io.BytesIO(data))
        lines: list[Line] = []
        for page_no, page in enumerate(reader.pages, start=1):
            text = page.extract_text() or ""
            lines.extend(Line(t, f"{page_no}쪽") for t in text.splitlines())
    except (PdfReadError, ValueError, KeyError) as exc:
        raise DocumentParseError(f"PDF를 읽지 못했어요 ({type(exc).__name__})") from exc
    return lines


def _docx_lines(data: bytes) -> list[Line]:
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    try:
        document = docx.Document(io.BytesIO(data))
    except Exception as exc:  # python-docx는 손상 파일에 여러 예외를 낸다
        raise DocumentParseError(f"DOCX를 읽지 못했어요 ({type(exc).__name__})") from exc

    lines: list[Line] = []
    para_no = 0
    table_no = 0
    # 본문 순서를 지키기 위해 문단과 표를 섞어서 순회한다.
    for child in document.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            para_no += 1
            text = Paragraph(child, document).text
            lines.extend(Line(t, f"문단 {para_no}") for t in text.splitlines())
        elif tag == "tbl":
            table_no += 1
            table = Table(child, document)
            for row_no, row in enumerate(table.rows, start=1):
                cells: list[str] = []
                for cell in row.cells:
                    value = " ".join(cell.text.split())
                    # 병합된 셀은 같은 값이 반복되므로 연속 중복을 뺀다.
                    if value and (not cells or cells[-1] != value):
                        cells.append(value)
                if cells:
                    lines.append(Line(" | ".join(cells), f"표 {table_no} {row_no}행"))
    return lines
