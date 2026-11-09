#!/usr/bin/env python3
"""SKRR 계약 문서끼리의 일치를 검사한다. 구현 코드는 검사하지 않는다.

사용법: python3 .claude/skills/skrr-integration-qa/scripts/check_contracts.py
의존성: PyYAML (없으면 pip install pyyaml)
문제가 있으면 종료 코드 1을 반환한다.
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("PyYAML이 필요합니다: pip install pyyaml")

ROOT = Path(__file__).resolve().parents[4]
CONTRACTS = ROOT / "docs" / "contracts"
SPECS = ["platform-api", "ai-api", "runner-api"]
REQUIREMENT_IDS = [f"FR-0{i}" for i in range(1, 8)] + ["NFR-01"]

errors: list[str] = []
passed: list[str] = []


def check(name: str, problems: list[str]) -> None:
    if problems:
        errors.extend(f"[{name}] {p}" for p in problems)
    else:
        passed.append(name)


def load_specs() -> dict[str, dict]:
    return {
        name: yaml.safe_load((CONTRACTS / f"{name}.openapi.yaml").read_text(encoding="utf-8"))
        for name in SPECS
    }


def iter_refs(node, path=""):
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "$ref" and isinstance(value, str):
                yield path, value
            else:
                yield from iter_refs(value, f"{path}/{key}")
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from iter_refs(value, f"{path}/{index}")


def resolve_pointer(doc, pointer: str) -> bool:
    current = doc
    for part in pointer.lstrip("/").split("/"):
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return False
    return True


def check_refs(specs: dict[str, dict], test_query: dict) -> None:
    problems = []
    for name, spec in specs.items():
        for path, ref in iter_refs(spec):
            if ref.startswith("#"):
                if not resolve_pointer(spec, ref[1:]):
                    problems.append(f"{name}: 해석할 수 없는 참조 {ref} ({path})")
            elif not (CONTRACTS / ref).exists():
                problems.append(f"{name}: 없는 파일 참조 {ref} ({path})")
    for path, ref in iter_refs(test_query):
        if ref.startswith("#") and not resolve_pointer(test_query, ref[1:]):
            problems.append(f"test-query: 해석할 수 없는 참조 {ref} ({path})")
    check("참조 해석", problems)


def operation_ids(specs: dict[str, dict]) -> dict[str, str]:
    found: dict[str, str] = {}
    problems = []
    for name, spec in specs.items():
        for route, item in spec.get("paths", {}).items():
            for method in ("get", "post", "put", "patch", "delete"):
                operation = item.get(method)
                if not operation:
                    continue
                op_id = operation.get("operationId")
                if not op_id:
                    problems.append(f"{name}: {method.upper()} {route}에 operationId 없음")
                elif op_id in found:
                    problems.append(f"operationId 중복: {op_id} ({found[op_id]}, {name})")
                else:
                    found[op_id] = name
    check("operationId 고유성", problems)
    return found


def check_enums(specs: dict[str, dict]) -> None:
    sql = (CONTRACTS / "schema.sql").read_text(encoding="utf-8")
    sql_enums: dict[str, set[str]] = {}
    for line in sql.splitlines():
        match = re.search(r"--\s*enum:(\w+)\s*$", line)
        if not match:
            continue
        check_part = line[line.index("CHECK") :] if "CHECK" in line else line
        values = set(re.findall(r"'([A-Za-z_.]+)'", check_part))
        name = match.group(1)
        if name in sql_enums and sql_enums[name] != values:
            errors.append(f"[enum 대조] schema.sql 안에서 {name} 값이 서로 다름")
        sql_enums[name] = values

    problems = []
    if not sql_enums:
        problems.append("schema.sql에서 enum 표시를 찾지 못함")

    spec_enums: dict[str, dict[str, set[str]]] = {}
    for spec_name, spec in specs.items():
        for schema_name, schema in spec.get("components", {}).get("schemas", {}).items():
            if isinstance(schema, dict) and "enum" in schema:
                spec_enums.setdefault(schema_name, {})[spec_name] = set(map(str, schema["enum"]))

    for name, values in sorted(sql_enums.items()):
        if name not in spec_enums:
            problems.append(f"{name}: schema.sql에는 있지만 OpenAPI에 없음")
            continue
        for spec_name, spec_values in spec_enums[name].items():
            if spec_values != values:
                problems.append(
                    f"{name}: schema.sql과 {spec_name} 불일치 "
                    f"(SQL만: {sorted(values - spec_values)}, 명세만: {sorted(spec_values - values)})"
                )

    for name, by_spec in sorted(spec_enums.items()):
        if len({frozenset(v) for v in by_spec.values()}) > 1:
            problems.append(f"{name}: 명세끼리 값이 다름 ({', '.join(by_spec)})")
    check("enum 대조 (schema.sql ↔ OpenAPI)", problems)


def check_traceability(found: dict[str, str]) -> None:
    text = (CONTRACTS / "traceability.md").read_text(encoding="utf-8")
    problems = []
    for requirement in REQUIREMENT_IDS:
        if not re.search(rf"^\|\s*{requirement}\s*\|", text, re.M):
            problems.append(f"추적표에 {requirement} 행이 없음")
    mentioned = set(re.findall(r"`([a-z][A-Za-z]+)`", text))
    candidates = {m for m in mentioned if re.search(r"[A-Z]", m)}
    for op_id in sorted(candidates - set(found)):
        problems.append(f"추적표의 `{op_id}`가 OpenAPI에 없음")
    for op_id in sorted(set(found) - mentioned):
        problems.append(f"{op_id} ({found[op_id]})가 추적표에 없음")
    check("요구사항 추적표", problems)


def check_screens() -> None:
    export = ROOT / "harness" / "references" / "export"
    problems = []
    if not export.exists():
        problems.append(f"화면 폴더 없음: {export}")
    else:
        screens = {
            match.group(1)
            for file in export.glob("*.png")
            if (match := re.match(r"(UI-[0-9A-Za-z-]+?)\s", unicodedata.normalize("NFC", file.name)))
        }
        spec = (ROOT / "harness" / "context" / "ui-screens.md").read_text(encoding="utf-8")
        trace = (CONTRACTS / "traceability.md").read_text(encoding="utf-8")
        for screen in sorted(screens):
            if screen not in spec:
                problems.append(f"{screen}가 ui-screens.md에 없음")
            if screen not in trace:
                problems.append(f"{screen}가 traceability.md에 없음")
        for file_name in re.findall(r"`(UI-[^`]+\.png)`", spec):
            names = {unicodedata.normalize("NFC", f.name) for f in export.glob("*.png")}
            if unicodedata.normalize("NFC", file_name) not in names:
                problems.append(f"ui-screens.md가 없는 파일을 가리킴: {file_name}")
    check("화면 대응", problems)


def check_ui_api_refs(found: dict[str, str]) -> None:
    text = (ROOT / "harness" / "context" / "ui-screens.md").read_text(encoding="utf-8")
    problems = []
    for line in text.splitlines():
        if line.startswith("사용 API:"):
            for op_id in re.findall(r"`([a-z][A-Za-z]+)`", line):
                if op_id not in found:
                    problems.append(f"ui-screens.md의 `{op_id}`가 OpenAPI에 없음")
    check("화면 사용 API", problems)


def check_events(specs: dict[str, dict]) -> None:
    text = (CONTRACTS / "events.md").read_text(encoding="utf-8")
    documented = set(re.findall(r"^\|\s*`([a-z.]+)`\s*\|", text, re.M))
    declared = set(specs["platform-api"]["components"]["schemas"]["RunEventType"]["enum"])
    problems = []
    if documented != declared:
        problems.append(
            f"events.md와 RunEventType 불일치 (문서만: {sorted(documented - declared)}, "
            f"enum만: {sorted(declared - documented)})"
        )
    check("SSE 이벤트", problems)


def check_state_machines(specs: dict[str, dict]) -> None:
    text = (CONTRACTS / "state-machines.md").read_text(encoding="utf-8")
    schemas = specs["platform-api"]["components"]["schemas"]
    names = [
        "DocumentStatus", "KnowledgeBaseStatus", "TestRequestStatus", "ScenarioStatus",
        "RunStatus", "ScenarioRunStatus", "CaseResultStatus",
    ]
    problems = []
    for name in names:
        for value in schemas[name]["enum"]:
            if not re.search(rf"\b{value}\b", text):
                problems.append(f"{name}.{value}가 state-machines.md에 없음")
    check("상태 전이 문서", problems)


def check_test_query_actions(test_query: dict) -> None:
    defs = test_query["$defs"]
    actions = set()
    problems = []
    for option in defs["step"]["oneOf"]:
        step = defs[option["$ref"].rsplit("/", 1)[-1]]
        action = step["properties"]["action"].get("const")
        if not action:
            problems.append(f"{option['$ref']}에 action 상수 없음")
        actions.add(action)
    runner_doc = ROOT / ".claude" / "skills" / "skrr-ai-pipeline" / "references" / "runner.md"
    if runner_doc.exists():
        runner_text = runner_doc.read_text(encoding="utf-8")
        for action in sorted(actions):
            if f"`{action}`" not in runner_text:
                problems.append(f"TestQuery 동작 {action}의 변환 규칙이 runner.md에 없음")
    check("TestQuery 동작", problems)


def main() -> int:
    specs = load_specs()
    test_query = json.loads((CONTRACTS / "schemas" / "test-query.schema.json").read_text(encoding="utf-8"))
    check_refs(specs, test_query)
    found = operation_ids(specs)
    check_enums(specs)
    check_traceability(found)
    check_screens()
    check_ui_api_refs(found)
    check_events(specs)
    check_state_machines(specs)
    check_test_query_actions(test_query)

    for name in passed:
        print(f"통과  {name}")
    for error in errors:
        print(f"실패  {error}")
    print(f"\n검사 {len(passed)}개 통과, 문제 {len(errors)}개 (operation {len(found)}개)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
