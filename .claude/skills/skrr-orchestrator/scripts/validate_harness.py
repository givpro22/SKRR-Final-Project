#!/usr/bin/env python3
"""SKRR 하네스 구조를 검사한다: 에이전트와 스킬 정의, 상호 참조, 문서 경로, CLAUDE.md 포인터.

사용법: python3 .claude/skills/skrr-orchestrator/scripts/validate_harness.py
문제가 있으면 종료 코드 1을 반환한다.
"""
from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
AGENTS = ROOT / ".claude" / "agents"
SKILLS = ROOT / ".claude" / "skills"
ORCHESTRATOR = "skrr-orchestrator"
REQUIRED_AGENT_SECTIONS = [
    "## 핵심 역할", "## 작업 원칙", "## 입력/출력 프로토콜",
    "## 팀 통신 프로토콜", "## 에러 핸들링", "## 협업", "## 재호출 시",
]
# 구현 후에 생기거나 실행 중에 만들어지는 경로는 존재 검사에서 뺀다.
PATH_PREFIXES = ("docs/", "harness/", ".claude/")
MAX_SKILL_LINES = 500

problems: list[str] = []


def frontmatter(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not match:
        problems.append(f"{path.relative_to(ROOT)}: frontmatter 없음")
        return {}
    fields = {}
    for line in match.group(1).splitlines():
        key, _, value = line.partition(":")
        fields[key.strip()] = value.strip().strip('"')
    return fields


def check_agents() -> list[str]:
    names = []
    for path in sorted(AGENTS.glob("*.md")):
        fields = frontmatter(path)
        text = path.read_text(encoding="utf-8")
        names.append(path.stem)
        if fields.get("name") != path.stem:
            problems.append(f"{path.name}: name이 파일명과 다름")
        if not fields.get("description"):
            problems.append(f"{path.name}: description 없음")
        if fields.get("model") != "opus":
            problems.append(f"{path.name}: model이 opus가 아님")
        for section in REQUIRED_AGENT_SECTIONS:
            if section not in text:
                problems.append(f"{path.name}: '{section}' 섹션 없음")
    return names


def check_skills() -> list[str]:
    names = []
    for directory in sorted(p for p in SKILLS.iterdir() if p.is_dir()):
        skill = directory / "SKILL.md"
        if not skill.exists():
            problems.append(f"{directory.name}: SKILL.md 없음")
            continue
        fields = frontmatter(skill)
        names.append(directory.name)
        if fields.get("name") != directory.name:
            problems.append(f"{directory.name}: name이 폴더명과 다름")
        description = fields.get("description", "")
        if len(description) < 80:
            problems.append(f"{directory.name}: description이 너무 짧음 (트리거 부족)")
        if "반드시" not in description:
            problems.append(f"{directory.name}: description에 적극적 트리거 문구 없음")
        lines = skill.read_text(encoding="utf-8").count("\n")
        if lines > MAX_SKILL_LINES:
            problems.append(f"{directory.name}: SKILL.md {lines}줄, {MAX_SKILL_LINES}줄 초과")
        for reference in directory.glob("references/*.md"):
            ref_lines = reference.read_text(encoding="utf-8").count("\n")
            if ref_lines >= 300 and "목차" not in reference.read_text(encoding="utf-8"):
                problems.append(f"{reference.relative_to(ROOT)}: 300줄 이상인데 목차 없음")
    return names


def check_links(agents: list[str], skills: list[str]) -> None:
    orchestrator = (SKILLS / ORCHESTRATOR / "SKILL.md").read_text(encoding="utf-8")
    description = frontmatter(SKILLS / ORCHESTRATOR / "SKILL.md").get("description", "")
    for agent in agents:
        if f"`{agent}`" not in orchestrator:
            problems.append(f"오케스트레이터에 에이전트 {agent} 없음")
    for skill in skills:
        if skill != ORCHESTRATOR and f"`{skill}`" not in orchestrator:
            problems.append(f"오케스트레이터에 스킬 {skill} 없음")
    for agent in agents:
        text = (AGENTS / f"{agent}.md").read_text(encoding="utf-8")
        used = set(re.findall(r"`(skrr-[a-z-]+)`", text))
        if not used:
            problems.append(f"{agent}: 사용하는 스킬 표시 없음")
        for skill in used - set(skills):
            problems.append(f"{agent}: 없는 스킬 {skill} 참조")
    for section in ("## 데이터 흐름", "## 에러 핸들링", "## 테스트 시나리오", "## 실행 모드", "### Phase 0"):
        if section not in orchestrator:
            problems.append(f"오케스트레이터에 '{section}' 없음")
    for keyword in ("재실행", "수정", "보완", "개선"):
        if keyword not in description:
            problems.append(f"오케스트레이터 description에 후속 키워드 '{keyword}' 없음")
    if "opus" not in orchestrator:
        problems.append("오케스트레이터에 model opus 명시 없음")


def check_paths() -> None:
    documents = list(AGENTS.glob("*.md")) + list(SKILLS.rglob("*.md")) + list((ROOT / "harness" / "context").glob("*.md"))
    documents += list((ROOT / "docs").rglob("*.md")) + [ROOT / "CLAUDE.md"]
    for document in documents:
        if not document.exists():
            continue
        text = document.read_text(encoding="utf-8")
        for match in re.findall(r"`([^`\n]+)`", text):
            candidate = match.split()[0] if match.endswith(".py") is False and " " not in match else match
            if not match.startswith(PATH_PREFIXES) or "{" in match or "*" in match or " | " in match:
                continue
            if match.startswith("docs/") and match.endswith("/"):
                continue
            target = ROOT / unicodedata.normalize("NFC", candidate)
            if not target.exists() and not _exists_nfd(candidate):
                problems.append(f"{document.relative_to(ROOT)}: 없는 경로 `{match}`")


def _exists_nfd(relative: str) -> bool:
    return (ROOT / unicodedata.normalize("NFD", relative)).exists()


def check_project_files(agents: list[str]) -> None:
    claude = ROOT / "CLAUDE.md"
    if not claude.exists():
        problems.append("CLAUDE.md 없음")
    else:
        text = claude.read_text(encoding="utf-8")
        for required in (ORCHESTRATOR, "변경 이력"):
            if required not in text:
                problems.append(f"CLAUDE.md에 '{required}' 없음")
        # 변경 이력에는 대상 파일로 에이전트 이름을 적을 수 있으므로 본문만 검사한다.
        body = text.split("변경 이력", 1)[0]
        for agent in agents:
            if agent in body:
                problems.append(f"CLAUDE.md에 에이전트 목록을 넣지 않는다: {agent}")
    if (ROOT / ".claude" / "commands").exists():
        problems.append(".claude/commands가 있으면 안 됨")


def main() -> int:
    agents = check_agents()
    skills = check_skills()
    check_links(agents, skills)
    check_paths()
    check_project_files(agents)
    print(f"에이전트 {len(agents)}개: {', '.join(agents)}")
    print(f"스킬 {len(skills)}개: {', '.join(skills)}")
    for problem in problems:
        print(f"실패  {problem}")
    print(f"\n문제 {len(problems)}개")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
