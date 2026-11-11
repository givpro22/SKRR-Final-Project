"""예제 요구사항 명세서(requirements.md)를 DOCX로 만든다.

백엔드 업로드(요구사항은 PDF·DOCX만)를 거치는 전체 흐름 검증용이다.

실행 (ai/ 에서):
    .venv/bin/python evals/corpus/build_docx.py          # requirements.docx 생성
    .venv/bin/python evals/corpus/build_docx.py --check  # 저장된 DOCX가 md와 같은지 확인 (다르면 종료 코드 1)

- 의존성은 ai 가상환경의 python-docx뿐이다.
- 같은 md면 항상 같은 바이트가 나오도록 문서 속성 시각과 ZIP 항목 시각을 고정한다 (재현 가능, diff 가능).
- 형식은 backend 템플릿(requirements_template.docx)과 같다: 요구사항마다 ID 줄, 설명, 수용 기준 문단.
  `#`는 문서 제목, `##`는 영역 제목(제목 1), `FR-` 줄은 요구사항 제목(제목 2), 나머지 줄은 본문 문단이 된다.
"""

from __future__ import annotations

import argparse
import io
import re
import sys
import zipfile
from datetime import datetime
from pathlib import Path

import docx

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "requirements.md"
TARGET = HERE / "requirements.docx"
FIXED_TIME = datetime(2026, 1, 1)
ZIP_TIME = (2026, 1, 1, 0, 0, 0)
_REQ = re.compile(r"^N?FR-")


def build(markdown: str) -> bytes:
    document = docx.Document()
    for raw in markdown.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("# "):
            document.add_heading(line[2:], level=0)
        elif line.startswith("## "):
            document.add_heading(line[3:], level=1)
        elif _REQ.match(line):
            document.add_heading(line, level=2)
        else:
            document.add_paragraph(line)
    props = document.core_properties
    props.author = "SKRR"
    props.last_modified_by = "SKRR"
    props.created = FIXED_TIME
    props.modified = FIXED_TIME
    props.last_printed = FIXED_TIME
    props.revision = 1
    buf = io.BytesIO()
    document.save(buf)
    return _normalize_zip(buf.getvalue())


def _normalize_zip(data: bytes) -> bytes:
    """ZIP 항목 시각을 고정해 실행할 때마다 바이트가 같게 한다."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as src, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            fixed = zipfile.ZipInfo(info.filename, date_time=ZIP_TIME)
            fixed.compress_type = zipfile.ZIP_DEFLATED
            fixed.external_attr = 0o644 << 16
            dst.writestr(fixed, src.read(info.filename))
    return out.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="저장된 DOCX가 md에서 만든 결과와 같은지만 확인")
    args = parser.parse_args()
    data = build(SOURCE.read_text(encoding="utf-8"))
    if args.check:
        same = TARGET.exists() and TARGET.read_bytes() == data
        print("일치" if same else f"불일치: {TARGET.name}를 다시 만드세요")
        return 0 if same else 1
    TARGET.write_bytes(data)
    print(f"{TARGET} ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
