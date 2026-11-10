from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
from typing import Any

import pytest
import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

FIXTURES = Path(__file__).parent / "fixtures"
CONTRACTS = Path(__file__).resolve().parents[2] / "docs" / "contracts"


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def make_docx(paragraphs: list[str], table: list[list[str]] | None = None) -> bytes:
    import docx

    document = docx.Document()
    for p in paragraphs:
        document.add_paragraph(p)
    if table:
        t = document.add_table(rows=len(table), cols=len(table[0]))
        for r, row in enumerate(table):
            for c, value in enumerate(row):
                t.cell(r, c).text = value
    buf = io.BytesIO()
    document.save(buf)
    return buf.getvalue()


def make_pdf(pages: list[list[str]]) -> bytes:
    """Helvetica 텍스트만 담은 최소 PDF. 줄마다 Td로 내려 쓴다."""
    objects: list[bytes] = []
    n_pages = len(pages)
    page_ids = [3 + i * 2 for i in range(n_pages)]
    font_id = 3 + n_pages * 2
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>".encode())
    for i, lines in enumerate(pages):
        content_id = page_ids[i] + 1
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_id} 0 R "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> >>".encode()
        )
        ops = ["BT", "/F1 12 Tf", "14 TL", "72 720 Td"]
        for line in lines:
            escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            ops.append(f"({escaped}) Tj T*")
        ops.append("ET")
        stream = "\n".join(ops).encode("latin-1")
        objects.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for idx, obj in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{idx} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


class ContractValidator:
    """ai-api.openapi.yaml의 components 스키마로 응답 본문을 검증한다."""

    def __init__(self) -> None:
        spec_path = CONTRACTS / "ai-api.openapi.yaml"
        spec = yaml.safe_load(spec_path.read_text(encoding="utf-8"))
        tq = json.loads((CONTRACTS / "schemas" / "test-query.schema.json").read_text(encoding="utf-8"))
        base = "https://skrr.invalid/contracts/ai-api.openapi.yaml"
        spec_resource = Resource.from_contents(spec, default_specification=_spec_2020())
        tq_resource = Resource.from_contents(tq, default_specification=_spec_2020())
        self._registry: Registry[Any] = Registry().with_resources(
            [(base, spec_resource), ("https://skrr.invalid/contracts/schemas/test-query.schema.json", tq_resource)]
        )
        self._base = base

    def validate(self, schema_name: str, instance: Any) -> None:
        schema = {"$ref": f"{self._base}#/components/schemas/{schema_name}"}
        validator = Draft202012Validator(schema, registry=self._registry)
        errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
        assert not errors, "\n".join(f"{list(e.path)}: {e.message}" for e in errors)


def _spec_2020() -> Any:
    from referencing.jsonschema import DRAFT202012

    return DRAFT202012


@pytest.fixture(scope="session")
def contract() -> ContractValidator:
    return ContractValidator()
