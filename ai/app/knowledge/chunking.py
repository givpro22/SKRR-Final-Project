"""요구사항 ID 단위 청킹. 문자 수로 자르지 않는다 (근거 인용과 가드 검사를 위해)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.knowledge.parsers.text_extract import Line

# 줄 맨 앞(글머리표, 제목 기호, 표 구분자, 괄호 뒤 포함)에 오는 FR-xx 형식 ID.
# 예: FR-CART-01, FR-ORD-01, FR-CPN-02, FR-01, NFR-01
REQUIREMENT_ID = re.compile(r"^[\s>#*\-•·|\[(]*((?:N?FR)-(?:[A-Z][A-Z0-9]*-)*\d+[A-Z]?)(?![A-Za-z0-9-])")
_HEADING = re.compile(r"^\s*#{1,6}\s")
_TITLE_SEP = re.compile(r"^[\s\]):.|\-–—]+")


@dataclass
class RequirementSection:
    requirement_id: str
    title: str
    location: str
    body: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n".join(self.body).strip()


def _title_from(rest: str) -> str:
    rest = _TITLE_SEP.sub("", rest).strip()
    # 표 행이면 첫 번째 셀을 제목으로 본다.
    if " | " in rest:
        rest = rest.split(" | ", 1)[0].strip()
    return rest[:200]


def split_requirements(lines: list[Line]) -> list[RequirementSection]:
    """줄 목록을 요구사항 ID 단위로 나눈다. 첫 ID 이전의 머리말은 버린다.

    같은 ID가 여러 번 나오면(목차와 본문 등) 하나로 합친다. 제목은 처음 나온 비어 있지 않은 것을 쓴다.
    """
    sections: dict[str, RequirementSection] = {}
    current: RequirementSection | None = None
    for line in lines:
        match = REQUIREMENT_ID.match(line.text)
        if match:
            rid = match.group(1)
            title = _title_from(line.text[match.end() :])
            existing = sections.get(rid)
            if existing is None:
                current = RequirementSection(rid, title, line.location)
                sections[rid] = current
            else:
                current = existing
                if not current.title and title:
                    current.title = title
            current.body.append(line.text.strip())
        elif _HEADING.match(line.text):
            # ID 없는 마크다운 제목은 새 단락의 시작이므로 앞 요구사항에 붙이지 않는다.
            current = None
        elif current is not None and line.text.strip():
            current.body.append(line.text.strip())
    return list(sections.values())
