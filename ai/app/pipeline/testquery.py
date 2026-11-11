"""승인된 케이스 → TestQuery (startTestQueryGeneration, FR-04, WBS 4.6, ADR-005).

LLM은 코드를 쓰지 않고 허용된 동작만 JSON으로 고른다. 코드가 하는 일:
- LLM 출력 모델 → TestQuery 변환 (맵은 [{name, value}] → 객체, bodyJson → JSON, 빈 필드 제거)
- 가드 (app/guards/testquery.py), 최대 3회 재생성, 같은 없는 testId가 반복되면 CATALOG_GAP
- 후처리: specOperation 채우기, 명세에서 responseSchema 복사($ref 풀기, LLM 값 폐기),
  Authorization 헤더에 쓴 캡처를 secretCaptures에 넣기, variables는 비움 (값은 실행 때 백엔드가 채운다, A16)
- 마지막에 test-query.schema.json으로 검증
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from app.api.jobs import Job
from app.core.codes import GuardFailureKind
from app.guards.scenario import GuardFailure, escalate_catalog_gap, progress_message, schema_invalid
from app.guards.testquery import VAR, check_test_query
from app.knowledge.models import ApiOperation
from app.llm.client import LLMClient, LLMOutputInvalidError
from app.pipeline import prompts
from app.pipeline.context import Catalog, open_knowledge_base
from app.pipeline.models import TestQueryOut, TestQueryStepOut
from app.pipeline.openapi import request_fields, response_schema

MAX_ATTEMPTS = 3
SCHEMA_PATH = Path(__file__).resolve().parents[1] / "contracts" / "test-query.schema.json"
LIST_LIMIT = 300

# 동작별로 TestQuery에 넣는 필드 (test-query.schema.json $defs)
FIELDS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    # action: (필수, 선택)
    "goto": (("path",), ()),
    "click": (("testId",), ()),
    "fill": (("testId", "value"), ()),
    "selectOption": (("testId", "value"), ()),
    "expectVisible": (("testId",), ("visible",)),
    "expectText": (("testId", "text"), ("match",)),
    "expectCount": (("testId", "count"), ()),
    "press": (("testId", "key"), ()),
    "expectUrl": (("path",), ("match",)),
    "captureText": (("testId", "as"), ()),
    "waitForApi": (("method", "path", "trigger"), ("expectStatus", "captures", "specOperation")),
    "apiRequest": (("method", "path"), ("headers", "body", "expectStatus", "captures", "specOperation")),
    "expectCapture": (("capture", "equals"), ()),
}


@cache
def _validator() -> Draft202012Validator:
    return Draft202012Validator(json.loads(SCHEMA_PATH.read_text(encoding="utf-8")))


def schema_errors(tq: dict[str, Any]) -> list[str]:
    errors = sorted(_validator().iter_errors(tq), key=lambda e: list(e.absolute_path))
    return [f"{'/'.join(str(p) for p in e.absolute_path) or '(최상위)'}: {e.message[:160]}" for e in errors]


@dataclass(frozen=True)
class TestQueryInput:
    project_id: str
    scenario: dict[str, Any]
    test_case: dict[str, Any]
    available_variables: list[str]
    previous_error: str | None = None
    # 프로젝트 queryApiBaseUrl의 경로 부분 (예 /api/test/query). 있으면 dbChecks 접두를 검사한다
    query_api_base_path: str | None = None


class ConversionError(Exception):
    pass


def _step_value(step: TestQueryStepOut, field: str) -> Any:
    if field == "as":
        return step.captureAs
    if field == "captures":
        return {nv.name: nv.value for nv in step.captures} or None
    if field == "headers":
        return {nv.name: nv.value for nv in step.headers} or None
    if field == "body":
        if step.bodyJson is None or not step.bodyJson.strip():
            return None
        try:
            return json.loads(step.bodyJson)
        except json.JSONDecodeError as exc:
            raise ConversionError(f"단계 {step.id}: bodyJson이 JSON이 아니에요 ({exc.msg})") from exc
    if field == "match" and step.match is not None:
        allowed = {"expectText": {"EXACT", "CONTAINS"}, "expectUrl": {"EXACT", "PREFIX"}}[step.action]
        if step.match not in allowed:
            raise ConversionError(
                f"단계 {step.id}: {step.action}의 match는 {', '.join(sorted(allowed))}만 쓸 수 있어요"
            )
    return getattr(step, field)


def convert(out: TestQueryOut, test_case_code: str) -> dict[str, Any]:
    """LLM 출력 → TestQuery 전송 형식. 동작에 필요한 필드가 없으면 ConversionError."""
    steps = []
    for step in out.steps:
        required, optional = FIELDS[step.action]
        item: dict[str, Any] = {"id": step.id, "description": step.description, "action": step.action}
        for field in required:
            value = _step_value(step, field)
            if value is None or value == "":
                raise ConversionError(f"단계 {step.id}: {step.action}에 {field}가 없어요")
            item[field] = value
        for field in optional:
            value = _step_value(step, field)
            if value is not None:
                item[field] = value
        steps.append(item)
    tq: dict[str, Any] = {
        "schemaVersion": "1.0",
        "testCaseCode": test_case_code,
        "title": out.title.strip()[:200] or test_case_code,
        "variables": {},
        "steps": steps,
    }
    if out.dbChecks:
        tq["dbChecks"] = [{k: v for k, v in c.model_dump().items() if v is not None} for c in out.dbChecks]
    if out.crossChecks:
        ccs = []
        for c in out.crossChecks:
            cc: dict[str, Any] = {"label": c.label}
            for key in ("uiCapture", "apiCapture", "dbCheckId"):
                if getattr(c, key):
                    cc[key] = getattr(c, key)
            if c.consistencyOnly:
                cc["consistencyOnly"] = True
                if c.reason:
                    cc["reason"] = c.reason
            if c.expected is not None:
                cc["expected"] = c.expected
            if c.normalize != "NONE":
                cc["normalize"] = c.normalize
            ccs.append(cc)
        tq["crossChecks"] = ccs
    if out.secretCaptures:
        tq["secretCaptures"] = list(dict.fromkeys(out.secretCaptures))
    return tq


def post_process(tq: dict[str, Any], catalog: Catalog) -> dict[str, Any]:
    """명세 기반 후처리. LLM이 쓴 specOperation·responseSchema는 버리고 코드가 명세에서 정한다 (ADR-014)."""
    secrets = list(tq.get("secretCaptures", []))
    for step in tq["steps"]:
        if step["action"] not in {"apiRequest", "waitForApi"}:
            continue
        step.pop("responseSchema", None)
        op = catalog.match_request(step["method"], step["path"])
        if op is None:
            step.pop("specOperation", None)
            continue
        step["specOperation"] = f"{op.method} {op.path}"
        if step.get("expectStatus") is not None:
            schema = response_schema(catalog.spec, op.method, op.path, int(step["expectStatus"]))
            if schema:
                step["responseSchema"] = schema
        for name, value in (step.get("headers") or {}).items():
            if name.lower() == "authorization":
                secrets.extend(VAR.findall(value))
    if secrets:
        tq["secretCaptures"] = list(dict.fromkeys(secrets))
    return tq


def _response_fields(catalog: Catalog, op: ApiOperation) -> list[str]:
    """성공 응답(첫 2xx) 최상위 필드 이름. 캡처할 JSONPath를 고를 때 쓴다."""
    ok = next((c for c in op.status_codes if c.startswith("2") and c.isdigit()), None)
    schema = response_schema(catalog.spec, op.method, op.path, int(ok)) if ok else None
    props = (schema or {}).get("properties")
    return sorted(props) if isinstance(props, dict) else []


def _context(catalog: Catalog, inp: TestQueryInput) -> dict[str, Any]:
    ops = []
    for op in catalog.operations:
        ops.append(
            {
                "operation": f"{op.method} {op.path}",
                "requestPath": catalog.request_path(op),
                "summary": op.summary,
                "statusCodes": list(op.status_codes),
                "readOnly": op.read_only,
                "security": list(op.security),
                "requestFields": request_fields(catalog.spec, op.method, op.path),
                "responseFields": _response_fields(catalog, op),
            }
        )
    return {
        "scenario": inp.scenario,
        "testCase": inp.test_case,
        "availableVariables": inp.available_variables,
        "previousError": inp.previous_error,
        "queryApiBasePath": inp.query_api_base_path,
        "apiBasePath": catalog.api_base_path,
        "apiOperations": ops[:LIST_LIMIT],
        "catalogElements": [
            {"testId": e.test_id, "page": e.page, "label": e.label, "type": e.element_type} for e in catalog.elements
        ][:LIST_LIMIT],
        "feedback": None,
        "attempt": 1,
    }


async def run_test_query_generation(job: Job, inp: TestQueryInput, llm: LLMClient, kb_dir: Path) -> dict[str, Any]:
    job.set_progress("RETRIEVE", 5, f"{inp.test_case.get('code')} 케이스에 필요한 명세를 읽고 있어요")
    with open_knowledge_base(kb_dir, inp.project_id) as kb:
        catalog = Catalog.load(kb)
    data = _context(catalog, inp)
    approved = list(inp.test_case.get("expectedValues", []))
    code = str(inp.test_case["code"])

    previous: list[GuardFailure] = []
    failures: list[GuardFailure] = []
    # 스키마를 지킨 마지막 결과와 그 시도의 가드 실패 (3회 실패해도 백엔드가 보고 판단할 수 있게)
    last_valid: tuple[dict[str, Any], list[GuardFailure], int] | None = None
    attempt = 0
    for attempt in range(1, MAX_ATTEMPTS + 1):
        message = f"{code} 실행 정의를 만들고 있어요" if attempt == 1 else progress_message(previous)
        job.set_progress("GENERATE", 10 + 28 * (attempt - 1), message, attempt=attempt, max_attempts=MAX_ATTEMPTS)
        data["attempt"] = attempt
        try:
            out = await llm.generate_json(
                system=prompts.system_prompt(prompts.TEST_QUERY), user=prompts.user_message(data), schema=TestQueryOut
            )
            tq = convert(out, code)
        except (LLMOutputInvalidError, ConversionError) as exc:
            failures = [schema_invalid(exc.message if isinstance(exc, LLMOutputInvalidError) else str(exc))]
        else:
            job.set_progress("GUARD", 20 + 28 * (attempt - 1), f"{code} 가드 검사 중이에요")
            failures = check_test_query(tq, catalog, inp.available_variables, approved, inp.query_api_base_path)
            tq = post_process(tq, catalog)
            errors = schema_errors(tq)
            if errors:
                failures.append(schema_invalid("; ".join(errors[:5])))
            failures = escalate_catalog_gap(failures, previous)
            if not errors:
                last_valid = (tq, failures, attempt)
        if not failures and last_valid is not None:
            return _result(last_valid[0], True, attempt, [])
        if any(f.kind is GuardFailureKind.CATALOG_GAP for f in failures):
            break
        previous = failures
        data["feedback"] = [f.message for f in failures]
    if last_valid is None:
        # 계약상 testQuery는 스키마를 지켜야 하므로, 형식이 맞는 결과가 한 번도 없으면 작업 실패로 돌려준다.
        raise LLMOutputInvalidError(
            f"{MAX_ATTEMPTS}번 시도해도 형식이 맞는 실행 정의를 만들지 못했어요: "
            + "; ".join(f.message for f in failures)[:500]
        )
    return _result(last_valid[0], False, attempt, last_valid[1] if last_valid[2] == attempt else failures)


def _result(tq: dict[str, Any], passed: bool, attempts: int, failures: list[GuardFailure]) -> dict[str, Any]:
    return {
        "kind": "TEST_QUERY_GENERATE",
        "testQuery": tq,
        "guard": {"passed": passed, "attempts": attempts, "failures": [f.to_contract() for f in failures]},
    }
