"""TestQuery 가드 (FR-04, ADR-005·014·017). 판정은 코드로 한다.

| 검사 | 실패 종류 |
|---|---|
| 변환 결과가 test-query.schema.json과 맞음, 금지 헤더 없음 | SCHEMA_INVALID |
| testId·trigger가 카탈로그에 있음 | UNKNOWN_TEST_ID |
| apiRequest·waitForApi·dbChecks 경로가 명세 작업과 맞음, dbChecks는 읽기 전용(GET) | UNKNOWN_API |
| {{이름}}이 availableVariables나 앞 단계 캡처에 있음, 이름 중복 없음, crossChecks 참조 캡처가 있음 | UNKNOWN_VARIABLE |
| expect* 단계, expectStatus, crossChecks 중 하나 이상 | NO_ASSERTION |
| crossChecks가 expected 또는 consistencyOnly+reason, 승인된 기대값마다 검증 단계가 있음 | MISSING_EXPECTED |
| crossChecks·expectCapture 기대값이 승인된 expectedValues와 같음 | EXPECTED_NOT_APPROVED |
"""

from __future__ import annotations

import json
import re
from typing import Any

from app.core.codes import GuardFailureKind
from app.guards.scenario import GuardFailure
from app.pipeline.context import Catalog

VAR = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")
FORBIDDEN_HEADERS = {"host", "content-length", "connection", "cookie"}
ASSERT_ACTIONS = {"expectVisible", "expectText", "expectCount", "expectUrl", "expectCapture"}


def _f(kind: GuardFailureKind, message: str, subject: str | None, cause: str) -> GuardFailure:
    return GuardFailure(kind, message, subject=subject, cause=cause)


def _refs(value: Any) -> list[str]:
    if value is None:
        return []
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return VAR.findall(text)


def check_test_query(
    tq: dict[str, Any],
    catalog: Catalog,
    available_variables: list[str],
    approved: list[dict[str, Any]],
    query_api_base_path: str | None = None,
) -> list[GuardFailure]:
    """query_api_base_path가 있으면(프로젝트 queryApiBaseUrl의 경로) dbChecks 경로가 그 아래인지 검사하고,
    없으면 명세의 읽기 전용 GET인지만 검사한다 (ai-api TestQueryGenerationRequest.queryApiBaseUrl)."""
    failures: list[GuardFailure] = []
    known_ids = catalog.test_ids
    variables = set(available_variables)
    defined: set[str] = set()
    seen_unknown: set[str] = set()

    def unknown_var(name: str, where: str) -> None:
        if name in seen_unknown:
            return
        seen_unknown.add(name)
        failures.append(
            _f(
                GuardFailureKind.UNKNOWN_VARIABLE,
                f"{where}에서 쓴 '{{{{{name}}}}}'은 테스트 데이터나 앞 단계 캡처에 없어요",
                name,
                f"'{name}' 변수가 없어",
            )
        )

    has_assertion = bool(tq.get("crossChecks"))
    for step in tq.get("steps", []):
        sid = step.get("id", "?")
        action = step.get("action")
        if action in ASSERT_ACTIONS or step.get("expectStatus") is not None:
            has_assertion = True
        for key in ("testId", "trigger"):
            tid = step.get(key)
            if tid and tid not in known_ids:
                failures.append(
                    _f(
                        GuardFailureKind.UNKNOWN_TEST_ID,
                        f"카탈로그에 '{tid}' 요소가 없어요",
                        tid,
                        f"카탈로그에 '{tid}' 요소가 없어",
                    )
                )
        if action in {"apiRequest", "waitForApi"}:
            method, path = step.get("method", ""), step.get("path", "")
            if catalog.match_request(method, path) is None:
                failures.append(
                    _f(
                        GuardFailureKind.UNKNOWN_API,
                        f"API 명세에 '{method} {path}' 작업이 없어요",
                        f"{method} {path}",
                        f"API 명세에 '{method} {path}'가 없어",
                    )
                )
            for name in step.get("headers") or {}:
                if name.lower() in FORBIDDEN_HEADERS:
                    failures.append(
                        _f(
                            GuardFailureKind.SCHEMA_INVALID,
                            f"단계 {sid}: {name} 헤더는 쓸 수 없어요",
                            name,
                            f"쓸 수 없는 {name} 헤더가 있어",
                        )
                    )
        # 참조는 그 단계 이전에 정의된 이름만 쓸 수 있다
        for key in ("path", "value", "body", "headers", "equals", "text"):
            for name in _refs(step.get(key)):
                if name not in variables and name not in defined:
                    unknown_var(name, f"단계 {sid}")
        if action == "expectCapture" and step.get("capture") not in defined:
            unknown_var(str(step.get("capture")), f"단계 {sid}")
        new_names = []
        if action == "captureText" and step.get("as"):
            new_names.append(step["as"])
        new_names.extend((step.get("captures") or {}).keys())
        for name in new_names:
            if name in variables or name in defined:
                failures.append(
                    _f(
                        GuardFailureKind.UNKNOWN_VARIABLE,
                        f"단계 {sid}: 캡처 이름 '{name}'이 변수나 다른 캡처와 겹쳐요",
                        name,
                        f"'{name}' 이름이 겹쳐",
                    )
                )
            defined.add(name)

    db_ids = set()
    for check in tq.get("dbChecks", []):
        db_ids.add(check.get("id"))
        path = str(check.get("path", ""))
        if query_api_base_path is not None:
            base = query_api_base_path.rstrip("/")
            bare = path.split("?", 1)[0]
            if not (bare == base or bare.startswith(base + "/")):
                failures.append(
                    _f(
                        GuardFailureKind.UNKNOWN_API,
                        f"DB 확인 '{check.get('label')}' 경로는 조회 API 주소({base or '/'}) 아래여야 해요",
                        path,
                        "DB 확인 경로가 조회 API 밖이어서",
                    )
                )
        else:
            op = catalog.match_request("GET", path)
            if op is None or not op.read_only:
                failures.append(
                    _f(
                        GuardFailureKind.UNKNOWN_API,
                        f"DB 확인 '{check.get('label')}'은 명세의 읽기 전용 조회 API(GET)만 쓸 수 있어요",
                        path,
                        "DB 확인이 읽기 전용 조회 API가 아니어서",
                    )
                )
        for name in _refs(check.get("path")) + _refs(check.get("expected")):
            if name not in variables:
                unknown_var(name, f"DB 확인 {check.get('id')}")

    for name in tq.get("secretCaptures", []):
        if name not in defined:
            unknown_var(name, "secretCaptures")

    if not has_assertion:
        failures.append(_f(GuardFailureKind.NO_ASSERTION, "검증 단계가 하나도 없어요", None, "검증 단계가 없어"))

    failures.extend(_expected_failures(tq, approved, defined, db_ids))
    return failures


def _expected_failures(
    tq: dict[str, Any], approved: list[dict[str, Any]], defined: set[str], db_ids: set[Any]
) -> list[GuardFailure]:
    failures: list[GuardFailure] = []
    by_label = {ev["label"]: ev for ev in approved}
    approved_values = {str(ev["expected"]) for ev in approved if ev.get("expected") is not None}

    for cc in tq.get("crossChecks", []):
        label = cc.get("label", "")
        for key in ("uiCapture", "apiCapture"):
            if cc.get(key) and cc[key] not in defined:
                failures.append(
                    _f(
                        GuardFailureKind.UNKNOWN_VARIABLE,
                        f"교차 검증 '{label}'의 {key} '{cc[key]}'를 캡처하는 단계가 없어요",
                        cc[key],
                        f"'{cc[key]}' 캡처가 없어",
                    )
                )
        if cc.get("dbCheckId") and cc["dbCheckId"] not in db_ids:
            failures.append(
                _f(
                    GuardFailureKind.UNKNOWN_VARIABLE,
                    f"교차 검증 '{label}'의 dbCheckId '{cc['dbCheckId']}'가 dbChecks에 없어요",
                    cc["dbCheckId"],
                    f"DB 확인 '{cc['dbCheckId']}'가 없어",
                )
            )
        has_expected = "expected" in cc
        only = cc.get("consistencyOnly") is True
        if has_expected == only or (only and not str(cc.get("reason", "")).strip()):
            failures.append(
                _f(
                    GuardFailureKind.MISSING_EXPECTED,
                    f"교차 검증 '{label}'에는 기대값이나 일관성 확인 이유 중 하나만 있어야 해요",
                    label,
                    f"교차 검증 '{label}'의 기대값이 없어",
                )
            )
            continue
        ev = by_label.get(label)
        ok = ev is not None and (
            (only and ev.get("consistencyOnly") is True)
            or (has_expected and ev.get("expected") is not None and str(cc["expected"]) == str(ev["expected"]))
        )
        if not ok:
            failures.append(
                _f(
                    GuardFailureKind.EXPECTED_NOT_APPROVED,
                    f"교차 검증 '{label}'의 기대값이 승인된 기대값과 달라요",
                    label,
                    f"'{label}' 기대값이 승인된 값과 달라",
                )
            )

    for step in tq.get("steps", []):
        if step.get("action") == "expectCapture" and str(step.get("equals")) not in approved_values:
            failures.append(
                _f(
                    GuardFailureKind.EXPECTED_NOT_APPROVED,
                    f"단계 {step.get('id')}의 기대값 '{step.get('equals')}'은 승인된 기대값이 아니에요",
                    str(step.get("equals")),
                    "승인되지 않은 기대값을 써",
                )
            )

    # 승인된 기대값마다 그것을 검증하는 단계나 교차 검증이 있어야 한다
    cc_labels = {cc.get("label") for cc in tq.get("crossChecks", [])}
    checked: set[str] = set()
    for step in tq.get("steps", []):
        for key in ("expectStatus", "equals", "text", "count", "path"):
            if key == "path" and step.get("action") != "expectUrl":
                continue
            if step.get(key) is not None and (key != "text" or step.get("action") == "expectText"):
                checked.add(str(step[key]))
    for ev in approved:
        label = ev["label"]
        covered = label in cc_labels or (ev.get("expected") is not None and str(ev["expected"]) in checked)
        if not covered:
            failures.append(
                _f(
                    GuardFailureKind.MISSING_EXPECTED,
                    f"승인된 기대값 '{label}'을 검증하는 단계가 없어요",
                    label,
                    f"승인된 기대값 '{label}'을 검증하지 않아",
                )
            )
    return failures
