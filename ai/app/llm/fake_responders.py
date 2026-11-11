"""가짜 LLM이 예제 문서에 맞는 그럴듯한 결과를 결정적으로 만드는 응답기 (ADR-010 미정 동안).

프롬프트의 <data> JSON만 읽어 규칙으로 답한다. 같은 입력이면 항상 같은 출력이다.
실제 모델 품질과는 무관하며, 파이프라인·가드·재시도 경로를 확인하는 용도다.

요청 문장에 아래 표시를 넣으면 장애 경로를 재현한다 (첫 번째 시나리오에만 적용):

| 표시 | 동작 |
|---|---|
| `#fake-guard-retry` | 1회차에 카탈로그에 없는 testId를 써서 UNKNOWN_TEST_ID → 2회차 통과 (attempts 2) |
| `#fake-guard-retry-2` | 1·2회차에 서로 다른 없는 testId → 3회차 통과 (attempts 3) |
| `#fake-guard-fail` | 매회 명세에 없는 API를 써서 UNKNOWN_API 3회 → 가드 실패 (attempts 3) |
| `#fake-catalog-gap` | 필요한 요소가 카탈로그에 없다고 알려 CATALOG_GAP → 재생성 없이 종료 (attempts 1) |
| `#fake-catalog-gap-repeat` | 같은 없는 testId를 1·2회차에 써서 2회차에 CATALOG_GAP 승격 (attempts 2) |
| `#fake-schema-invalid` | 1회차에 형식이 틀린 출력 → SCHEMA_INVALID → 2회차 통과 |
| `#fake-bad-reference` | (요청 정제) 1회차에 검색 결과에 없는 근거 → 2회차 통과 |
| `#fake-refine-invalid` | (요청 정제) 매회 없는 근거 → 3회 뒤 INVALID_LLM_OUTPUT |
| `#fake-llm-down` | LLM 호출이 일시 오류 → 재시도 후 LLM_UNAVAILABLE |

TestQuery 생성(startTestQueryGeneration)은 케이스 제목·단계·사전조건에 넣은 표시를 본다:

| 표시 | 동작 |
|---|---|
| `#fake-tq-retry` | 1회차에 카탈로그에 없는 testId → 2회차 통과 |
| `#fake-tq-fail` | 매회 명세에 없는 API → 가드 3회 실패 (passed false, testQuery는 형식이 맞는 마지막 결과) |
| `#fake-tq-not-approved` | 매회 승인되지 않은 기대값 → EXPECTED_NOT_APPROVED 3회 |
| `#fake-tq-invalid` | 매회 형식이 틀린 출력 → 작업 FAILED INVALID_LLM_OUTPUT |
| `#fake-analysis-ungrounded` | (원인 분석, caseTitle) 근거 번호가 없는 후보를 1순위로 섞는다 → 가드가 버리는지 확인 |
| `#fake-analysis-empty` | (원인 분석, caseTitle) 후보를 내지 않는다 → 빈 결과 |
| `#fake-dbcheck-outside` | 조회 API 밖 경로(/api/cart, GET)를 dbChecks에 넣는다 (백엔드 queryApiBaseUrl 검사 확인용) |

표시는 정확히 일치할 때만 적용된다 (`#fake-guard-retry`는 `#fake-guard-retry-2`에 걸리지 않음).
지연이 필요하면 FAKE_LLM_DELAY_MS로 호출마다 기다리게 한다.
"""

from __future__ import annotations

import json
import re
from typing import Any

from app.llm.client import LLMTransientError
from app.llm.fake import FakeLLMClient
from app.pipeline.models import AnalysisOut, RefinementOut, ScenarioDraftOut, ScenarioPlanOut, TestQueryOut
from app.pipeline.prompts import parse_user_message

GUARD_RETRY = "#fake-guard-retry"
GUARD_RETRY_2 = "#fake-guard-retry-2"
GUARD_FAIL = "#fake-guard-fail"
CATALOG_GAP = "#fake-catalog-gap"
CATALOG_GAP_REPEAT = "#fake-catalog-gap-repeat"
SCHEMA_INVALID = "#fake-schema-invalid"
BAD_REFERENCE = "#fake-bad-reference"
REFINE_INVALID = "#fake-refine-invalid"
LLM_DOWN = "#fake-llm-down"
TQ_RETRY = "#fake-tq-retry"
TQ_FAIL = "#fake-tq-fail"
TQ_NOT_APPROVED = "#fake-tq-not-approved"
TQ_INVALID = "#fake-tq-invalid"
TQ_DBCHECK_OUTSIDE = "#fake-dbcheck-outside"
ANALYSIS_UNGROUNDED = "#fake-analysis-ungrounded"
ANALYSIS_EMPTY = "#fake-analysis-empty"
_MARK = re.compile(r"#fake-[a-z0-9-]+")

FAKE_MISSING_TEST_ID = "cart-remove-all-button"
FAKE_MISSING_TEST_ID_2 = "cart-clear-button"
FAKE_UNKNOWN_API = "DELETE /api/cart/all"
FAKE_MISSING_ELEMENT = "장바구니 전체 비우기 버튼"

_TOKEN = re.compile(r"[0-9a-z가-힣]+")
_RANGE = re.compile(r"(\d+)\s*[~～-]\s*(\d+)")
_ACTION_TYPES = {"button", "link", "checkbox", "radio"}
_INPUT_TYPES = {"input", "select", "textarea"}


def _bigrams(text: str) -> set[str]:
    grams: set[str] = set()
    for tok in _TOKEN.findall(text.lower()):
        if len(tok) == 1:
            grams.add(tok)
        grams.update(tok[i : i + 2] for i in range(len(tok) - 1))
    return grams


def _overlap(query: str, target: str) -> float:
    q = _bigrams(query)
    return len(q & _bigrams(target)) / len(q) if q else 0.0


def _has(text: str, mark: str) -> bool:
    return mark in _MARK.findall(text)


def _down(request_text: str) -> None:
    if _has(request_text, LLM_DOWN):
        raise LLMTransientError("가짜 LLM 장애 (#fake-llm-down)")


def _clean_request(text: str) -> str:
    return re.sub(r"#fake-[a-z-]+", "", text).strip()


# --- 요청 정제 ---


def refine(system: str, user: str) -> dict[str, Any]:
    data = parse_user_message(user)
    request = str(data["requestText"])
    _down(request)
    refs: list[dict[str, Any]] = list(data["references"])
    if not refs:
        return {"candidates": []}
    reqs = [r for r in refs if r["sourceType"] == "REQUIREMENT"]
    primary = reqs[0] if reqs else refs[0]
    others = [r["sourceId"] for r in refs if r is not primary]
    name = f"{primary['title']}({primary['sourceId']})" if primary["title"] else primary["sourceId"]
    clean = _clean_request(request)

    texts: list[tuple[str, bool]] = []
    if _overlap(clean, f"{primary['title']} {primary['text']}") < 0.2:
        texts.append((f"요청한 '{clean}'은 명세에 없는 기능이에요. 가장 가까운 명세인 {name}를 확인할게요", True))
    texts += [
        (f"{name} 정상 흐름에서 화면, API, DB의 값이 명세와 같은지 확인", False),
        (f"{name} 실패·예외 상황에서 명세의 오류 응답과 안내대로 처리되는지 확인", False),
        (f"{name} 입력값 경계에서 명세의 허용 범위대로 동작하는지 확인", False),
    ]
    if len(reqs) > 1:
        second = reqs[1]
        texts.append((f"{name}와 {second['title']}({second['sourceId']})를 이어서 확인", False))

    bad = _has(request, REFINE_INVALID) or (_has(request, BAD_REFERENCE) and not data.get("feedback"))
    candidates = []
    for i, (text, out_of_spec) in enumerate(texts[: int(data["candidateCount"])]):
        ids = [primary["sourceId"], *others]
        if bad and i == 0:
            ids = ["FR-NOPE-99"]
        candidates.append({"refinedText": text, "referenceIds": ids, "outOfSpec": out_of_spec})
    return {"candidates": candidates}


# --- 시나리오 계획 ---


def _first_sentence(text: str) -> str:
    lines = [ln.strip() for ln in text.splitlines()[1:] if ln.strip()]
    return lines[0] if lines else ""


def plan(system: str, user: str) -> dict[str, Any]:
    data = parse_user_message(user)
    request = str(data["requestText"])
    _down(request)
    known = {r["id"]: r["title"] for r in data["requirements"]}
    picked: list[dict[str, Any]] = []
    for chunk in data["retrieved"]:
        if chunk["sourceType"] == "REQUIREMENT" and chunk["sourceId"] in known and len(picked) < 2:
            picked.append(chunk)
    has_db = any("/query" in op["operation"] for op in data["apiOperations"])
    scenarios = []
    for chunk in picked:
        rid = chunk["sourceId"]
        elements = [e for e in data["catalogElements"] if rid in e["requirementRefs"]]
        apis = [op for op in data["apiOperations"] if rid in (op.get("summary") or "")]
        scopes = [s for s, ok in (("UI", elements), ("API", apis), ("DB", has_db and apis)) if ok]
        scenarios.append(
            {
                "title": f"{known[rid]} 검증",
                "requirementRef": rid,
                "scopes": scopes or ["UI"],
                "focus": _first_sentence(chunk["text"]) or known[rid],
            }
        )
    if not scenarios:
        scenarios.append(
            {
                "title": _clean_request(request)[:60] or "요청 검증",
                "requirementRef": None,
                "scopes": ["UI"],
                "focus": "",
            }
        )
    return {"scenarios": scenarios}


# --- 시나리오 본문 ---


def _status(codes: list[str], prefix: str) -> str | None:
    return next((c for c in codes if c.startswith(prefix)), None)


def draft(system: str, user: str) -> dict[str, Any]:
    data = parse_user_message(user)
    request = str(data["requestText"])
    _down(request)
    first = data["scenarioIndex"] == 0
    attempt = int(data["attempt"])
    if first and _has(request, SCHEMA_INVALID) and attempt == 1:
        return {"title": 1, "cases": "형식이 틀린 출력"}

    plan_ = data["plan"]
    title = plan_["title"]
    elements: list[dict[str, Any]] = data["relatedElements"]
    apis: list[dict[str, Any]] = data["relatedApis"]
    has_db = "DB" in plan_["scopes"]
    # 동작(버튼 등)이 있는 화면에서 입력·클릭하고, 다른 화면의 요소는 이동해서 값을 확인한다.
    pages = [e["page"] for e in elements if str(e["page"]).startswith("/")]
    action_page = next((e["page"] for e in elements if e["type"] in _ACTION_TYPES), pages[0] if pages else None)
    here = [e for e in elements if e["page"] == action_page]
    actions = [e for e in here if e["type"] in _ACTION_TYPES]
    inputs = [e for e in here if e["type"] in _INPUT_TYPES]
    displays = [e for e in elements if e not in actions and e not in inputs]
    writes = [a for a in apis if not a["operation"].startswith("GET ")]
    candidates = writes or apis
    primary: dict[str, Any] | None = candidates[0] if candidates else None
    name = title.removesuffix(" 검증")

    def ui_steps(boundary: tuple[str, str] | None = None) -> tuple[list[str], list[str]]:
        """boundary=(testId, 값)이면 그 입력란에만 경계값을 넣는다."""
        steps: list[str] = []
        used: list[str] = []
        if action_page:
            steps.append(f"`{action_page}` 화면으로 이동")
        for e in inputs:
            value = boundary[1] if boundary and boundary[0] == e["testId"] else "유효한 값"
            steps.append(f"{e['label']} `{e['testId']}`에 {value} 입력")
            used.append(e["testId"])
        for e in actions:
            steps.append(f"{e['label']} `{e['testId']}` 클릭")
            used.append(e["testId"])
        return steps, used

    scopes = [s for s, ok in (("UI", elements), ("API", primary), ("DB", has_db)) if ok]
    cases: list[dict[str, Any]] = []

    # 정상
    steps, used = ui_steps()
    expected: list[dict[str, Any]] = []
    api_ops: list[str] = []
    if primary:
        op = primary["operation"]
        steps.append(f"`{op}` 응답 확인")
        api_ops.append(op)
        ok_code = _status(primary["statusCodes"], "2")
        if ok_code:
            expected.append({"label": f"{op} 응답 상태", "expected": ok_code, "consistencyOnly": False, "reason": None})
    current_page = action_page
    for e in displays:
        if e["page"] != current_page and str(e["page"]).startswith("/"):
            current_page = e["page"]
            steps.append(f"`{current_page}` 화면으로 이동")
        steps.append(f"{e['label']} `{e['testId']}` 값 확인")
        used.append(e["testId"])
        expected.append(
            {
                "label": f"{e['label']} (화면·API·DB)",
                "expected": None,
                "consistencyOnly": True,
                "reason": "초기 데이터의 값을 명세에서 알 수 없어 세 출처의 값이 같은지만 확인한다",
            }
        )
    if not expected:
        criterion = _first_sentence(str(data.get("requirementText") or "")) or f"{title} 결과가 명세와 같다"
        expected.append(
            {"label": "요구사항 수용 기준", "expected": criterion, "consistencyOnly": False, "reason": None}
        )
    missing_id = None
    if first and _has(request, GUARD_RETRY) and attempt == 1:
        missing_id = FAKE_MISSING_TEST_ID
    elif first and _has(request, GUARD_RETRY_2) and attempt <= 2:
        # 회차마다 다른 testId라 CATALOG_GAP으로 승격되지 않는다
        missing_id = FAKE_MISSING_TEST_ID if attempt == 1 else FAKE_MISSING_TEST_ID_2
    elif first and _has(request, CATALOG_GAP_REPEAT):
        missing_id = FAKE_MISSING_TEST_ID
    if missing_id:
        steps.append(f"전체 비우기 `{missing_id}` 클릭")
        used.append(missing_id)
    if first and _has(request, GUARD_FAIL):
        steps.append(f"`{FAKE_UNKNOWN_API}` 호출")
        api_ops.append(FAKE_UNKNOWN_API)
    preconditions = ["테스트 데이터로 초기화된 상태", "테스트 계정으로 로그인한 상태"]
    if data.get("userFeedback"):
        preconditions.append(f"사용자 의견 반영: {data['userFeedback']}")
    cases.append(
        {
            "title": f"{name} 정상 처리",
            "type": "NORMAL",
            "scopes": scopes or ["UI"],
            "preconditions": preconditions,
            "steps": steps,
            "expectedResult": f"{name}: 명세대로 처리되고 화면·API·DB 값이 일치한다",
            "expectedValues": expected,
            "uiElements": used,
            "apiOperations": api_ops,
        }
    )

    # 예외: 명세에 4xx 응답이 있을 때만
    err_code = _status(primary["statusCodes"], "4") if primary else None
    if primary and err_code:
        op = primary["operation"]
        steps, used = ui_steps()
        steps.append(f"`{op}` 응답 확인")
        cases.append(
            {
                "title": f"{name} 오류 응답 {err_code}",
                "type": "EXCEPTION",
                "scopes": [s for s in scopes if s != "DB"] or ["API"],
                "preconditions": [*preconditions, f"명세의 {err_code} 응답 조건을 만든 상태"],
                "steps": steps,
                "expectedResult": f"요청이 거부되고 {err_code} 응답과 안내 문구가 표시된다",
                "expectedValues": [
                    {"label": f"{op} 응답 상태", "expected": err_code, "consistencyOnly": False, "reason": None}
                ],
                "uiElements": used,
                "apiOperations": [op],
            }
        )

    # 경계: 요구사항에 숫자 범위가 있고 입력 요소가 있을 때만
    req_text = str(data.get("requirementText") or "")
    match = _RANGE.search(req_text)
    if match and inputs:
        lo, hi = int(match.group(1)), int(match.group(2))
        # 범위가 적힌 문장과 이름이 가장 많이 겹치는 입력란을 고른다 (예: "비밀번호는 8~20자" → 비밀번호 입력).
        sentence = next((ln for ln in req_text.splitlines() if match.group(0) in ln), req_text)
        target = max(inputs, key=lambda e: _overlap(str(e["label"]), sentence))
        steps, used = ui_steps(boundary=(target["testId"], str(hi + 1)))
        cases.append(
            {
                "title": f"{name} 경계값 {hi + 1}",
                "type": "BOUNDARY",
                "scopes": ["UI"],
                "preconditions": preconditions,
                "steps": steps,
                "expectedResult": f"허용 범위 {lo}~{hi}를 벗어난 {hi + 1}은 받아들이지 않는다",
                "expectedValues": [
                    {
                        "label": f"{target['label']}에 {hi + 1} 입력 결과",
                        "expected": "입력 거부",
                        "consistencyOnly": False,
                        "reason": None,
                    }
                ],
                "uiElements": used,
                "apiOperations": [],
            }
        )

    return {
        "title": title,
        "requirementRef": plan_["requirementRef"],
        "scopes": scopes or ["UI"],
        "cases": cases,
        "missingElements": [FAKE_MISSING_ELEMENT] if first and _has(request, CATALOG_GAP) else [],
    }


# --- TestQuery ---

_BACKTICK = re.compile(r"`([^`]+)`")
_OP = re.compile(r"^(GET|POST|PUT|PATCH|DELETE)\s+(/\S*)$")
_FILL_VALUE = re.compile(r"`[^`]+`에\s+(.+?)\s+입력")


def _blank_step(sid: str, description: str, action: str, **fields: Any) -> dict[str, Any]:
    step: dict[str, Any] = {
        "id": sid,
        "description": description,
        "action": action,
        "testId": None,
        "path": None,
        "value": None,
        "text": None,
        "match": None,
        "count": None,
        "visible": None,
        "key": None,
        "captureAs": None,
        "method": None,
        "trigger": None,
        "expectStatus": None,
        "captures": [],
        "headers": [],
        "bodyJson": None,
        "specOperation": None,
        "capture": None,
        "equals": None,
    }
    step.update(fields)
    return step


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _var_for(variables: list[str], *hints: str) -> str | None:
    for hint in hints:
        found = next((v for v in variables if hint in v.lower()), None)
        if found:
            return found
    return None


def _fill_path(path: str, variables: list[str], keep_unknown: bool = False) -> str:
    """경로 변수(:id, {productId})를 테스트 데이터 변수 {{이름}}으로 채운다.

    값을 모르면 1. keep_unknown이면 {이름}(중괄호 하나)으로 남긴다 — waitForApi에서는 아무 한 세그먼트와 맞는다.
    """

    def sub(match: re.Match[str]) -> str:
        name = match.group(1) or match.group(2)
        var = name if name in variables else _var_for(variables, name.lower()) if name != "id" else None
        if name == "id":
            var = _var_for(variables, "productid")
        if var:
            return f"{{{{{var}}}}}"
        return f"{{{name}}}" if keep_unknown and match.group(1) else "1"

    return re.sub(r"\{([A-Za-z_][A-Za-z0-9_]*)\}|:([A-Za-z_][A-Za-z0-9_]*)", sub, path)


def _fill_value(test_id: str, label: str, raw: str, variables: list[str], error_status: int | None = None) -> str:
    if raw and raw != "유효한 값":
        return raw
    key = f"{test_id} {label}".lower()
    # 예외 케이스: 명세의 오류 상태 코드가 나오도록 값을 고른다 (가짜 대상 사이트 규칙과 같다)
    if error_status == 401 and ("password" in key or "비밀번호" in key):
        return "wrong-password"
    if error_status == 409 and any(k in key for k in ("qty", "quantity", "수량")):
        return "9999"
    if error_status == 400 and any(k in key for k in ("qty", "quantity", "수량")):
        return "100"
    if "email" in key or "이메일" in key:
        var = _var_for(variables, "email")
        return f"{{{{{var}}}}}" if var else "member@example.test"
    if "password" in key or "비밀번호" in key:
        var = _var_for(variables, "password")
        return f"{{{{{var}}}}}" if var else "password-not-set"
    if any(k in key for k in ("qty", "quantity", "수량")):
        return "2"
    if "rating" in key or "별점" in key:
        return "5"
    if "zip" in key or "우편" in key:
        return "06236"
    return "테스트"


def _body_value(name: str, info: dict[str, Any], variables: list[str], status: int | None) -> Any:
    """요청 본문 값. 변수 이름과 같으면 {{이름}}, 오류 케이스면 명세 제약을 벗어나는 값."""
    typ = info.get("type", "string")
    if status == 400:
        if "maximum" in info:
            return int(info["maximum"]) + 1
        if "minLength" in info:
            return "x" * max(0, int(info["minLength"]) - 1)
        if "pattern" in info:
            return "형식-오류"
    if status == 401 and "password" in name.lower():
        return "wrong-password"
    if status == 409 and name.lower() in {"quantity", "qty"}:
        return 9999
    if name in variables:
        return f"{{{{{name}}}}}"
    var = _var_for(variables, name.lower())
    if var:
        return f"{{{{{var}}}}}"
    if typ == "integer":
        return int(info.get("minimum", 1))
    if "enum" in info:
        return info["enum"][0]
    return "06236" if "zip" in name.lower() else "테스트"


def test_query(system: str, user: str) -> dict[str, Any]:
    data = parse_user_message(user)
    tc: dict[str, Any] = data["testCase"]
    marks = " ".join([tc.get("title", ""), *tc.get("steps", []), *tc.get("preconditions", [])])
    _down(marks)
    attempt = int(data["attempt"])
    if _has(marks, TQ_INVALID):
        return {"title": tc["title"], "steps": "형식이 틀린 출력"}

    variables: list[str] = data["availableVariables"]
    elements = {e["testId"]: e for e in data["catalogElements"]}
    ops = {o["operation"]: o for o in data["apiOperations"]}
    approved: list[dict[str, Any]] = tc["expectedValues"]
    steps: list[dict[str, Any]] = []
    captures_by_test_id: dict[str, str] = {}
    api_captures: dict[str, str] = {}

    def add(description: str, action: str, **fields: Any) -> dict[str, Any]:
        step = _blank_step(f"s{len(steps) + 1:02d}", description, action, **fields)
        steps.append(step)
        return step

    def expected_status(op_key: str) -> int | None:
        for ev in approved:
            if ev["label"].startswith(op_key) and str(ev.get("expected", "")).isdigit():
                return int(ev["expected"])
        return None

    error_status = next(
        (int(ev["expected"]) for ev in approved if str(ev.get("expected", "")).isdigit() and ev["expected"][0] in "45"),
        None,
    )

    # 로그인 사전조건: 카탈로그에 로그인 화면이 있고 계정 변수가 있으면 화면으로 로그인한다
    login_ids = [t for t in elements if t.startswith("login-")]
    email_var, password_var = _var_for(variables, "email"), _var_for(variables, "password")
    if any("로그인" in p for p in tc.get("preconditions", [])) and login_ids and email_var and password_var:
        page = elements[login_ids[0]]["page"]
        add("로그인 화면으로 이동", "goto", path=page)
        for t in login_ids:
            el = elements[t]
            if el["type"] == "input":
                add(f"로그인: {el['label']}", "fill", testId=t, value=_fill_value(t, el["label"], "", variables))
        for t in login_ids:
            if elements[t]["type"] == "button":
                add("로그인", "click", testId=t)

    for raw in tc.get("steps", []):
        for token in _BACKTICK.findall(raw):
            token = token.strip()
            op_match = _OP.match(token)
            if token.startswith("/") and "이동" in raw:
                add(raw, "goto", path=_fill_path(token, variables))
            elif op_match:
                op = ops.get(token)
                if op is None:
                    continue
                status = expected_status(token)
                request_path = _fill_path(op["requestPath"], variables)
                if status == 404:
                    # 없는 대상을 가리키도록 경로 변수 세그먼트를 바꾼다 (/ 는 그대로 둔다, Q-M3-2)
                    request_path = re.sub(r"(?<=/)(\{\{[A-Za-z_][A-Za-z0-9_]*\}\}|1)(?=/|$)", "999999", request_path)
                prev = steps[-1] if steps else None
                # 화면 동작으로는 없는 대상을 요청하게 만들 수 없으므로 404 케이스는 API를 직접 부른다
                if prev and prev["action"] == "click" and status != 404:
                    # 화면 동작이 일으킨 API 응답을 기다린다
                    steps.pop()
                    target = add(
                        f"{prev['description']} 후 {token} 응답 확인",
                        "waitForApi",
                        method=op_match.group(1),
                        # 화면이 실제로 보내는 id를 미리 알 수 없으면 {이름} 자리로 둔다 (계약: waitForApi path)
                        path=_fill_path(op["requestPath"], variables, keep_unknown=True),
                        trigger=prev["testId"],
                        expectStatus=status,
                    )
                else:
                    body = {
                        name: _body_value(name, info, variables, status)
                        for name, info in op.get("requestFields", {}).items()
                    }
                    target = add(
                        f"{token} 호출",
                        "apiRequest",
                        method=op_match.group(1),
                        path=request_path,
                        expectStatus=status,
                        bodyJson=json.dumps(body, ensure_ascii=False) if body else None,
                    )
                for field_name in op.get("responseFields", []):
                    cap = f"api_{_norm(field_name)}"[:40]
                    api_captures[_norm(field_name)] = cap
                    target["captures"].append({"name": cap, "value": f"$.{field_name}"})
            else:
                # 카탈로그에 없는 testId도 그대로 옮긴다 (판정은 가드가 한다)
                el = elements.get(token, {"label": token, "type": ""})
                if "입력" in raw:
                    m = _FILL_VALUE.search(raw)
                    value = _fill_value(token, el["label"], m.group(1) if m else "", variables, error_status)
                    add(raw, "selectOption" if el["type"] == "select" else "fill", testId=token, value=value)
                elif "클릭" in raw:
                    add(raw, "click", testId=token)
                elif "확인" in raw:
                    cap = f"ui_{_norm(token)}"[:40]
                    captures_by_test_id[token] = cap
                    add(raw, "captureText", testId=token, captureAs=cap)

    if _has(marks, TQ_RETRY) and attempt == 1:
        add("전체 비우기", "click", testId=FAKE_MISSING_TEST_ID)
    if _has(marks, TQ_FAIL):
        add("명세에 없는 API 호출", "apiRequest", method="DELETE", path="/api/cart/all", expectStatus=204)

    cross_checks = []
    for ev in approved:
        label = ev["label"]
        covered = ev.get("expected") is not None and any(
            str(s.get("expectStatus")) == str(ev["expected"]) for s in steps if s.get("expectStatus") is not None
        )
        if covered:
            continue
        ui = next(
            (cap for t, cap in captures_by_test_id.items() if label.startswith(elements.get(t, {}).get("label", "\0"))),
            None,
        )
        api = None
        if ui:
            test_id = next(t for t, c in captures_by_test_id.items() if c == ui)
            api = next((c for f, c in api_captures.items() if _norm(test_id).endswith(f)), None)
        expected = ev.get("expected")
        if _has(marks, TQ_NOT_APPROVED) and expected is not None:
            expected = f"{expected}-변경"
        cross_checks.append(
            {
                "label": label,
                "uiCapture": ui,
                "apiCapture": api,
                "dbCheckId": None,
                "expected": None if ev.get("consistencyOnly") else expected,
                "consistencyOnly": bool(ev.get("consistencyOnly")),
                "reason": ev.get("reason") if ev.get("consistencyOnly") else None,
                "normalize": "NUMBER" if api else "NONE",
            }
        )
    if _has(marks, TQ_NOT_APPROVED) and not any(c["expected"] for c in cross_checks):
        cross_checks.append(
            {
                "label": approved[0]["label"],
                "uiCapture": None,
                "apiCapture": None,
                "dbCheckId": None,
                "expected": "승인되지 않은 값",
                "consistencyOnly": False,
                "reason": None,
                "normalize": "NONE",
            }
        )
    if not steps:
        add("첫 화면으로 이동", "goto", path="/")
    db_checks = []
    if _has(marks, TQ_DBCHECK_OUTSIDE):
        cart = next((o for o in ops.values() if o["operation"] == "GET /cart"), None)
        if cart:
            db_checks.append(
                {
                    "id": "outside_query_api",
                    "label": "조회 API 밖 경로",
                    "phase": "AFTER",
                    "path": cart["requestPath"],
                    "jsonPath": "$.totalAmount",
                    "expected": None,
                }
            )
    return {
        "title": tc["title"],
        "steps": steps,
        "dbChecks": db_checks,
        "crossChecks": cross_checks,
        "secretCaptures": [],
    }


# --- 실패 원인 분석 ---


def analyze(system: str, user: str) -> dict[str, Any]:
    """규칙 관찰(hints)을 그대로 후보로 쓰는 결정적 응답기. 실제 모델 품질과 무관하다."""
    data = parse_user_message(user)
    title = str(data["caseTitle"])
    _down(title)
    ftype = data["failureType"]
    facts_text = " ".join(f["text"] for f in data["facts"])
    money = re.search(r"금액|합계|결제|가격", facts_text + title) is not None
    if ftype == "API_ERROR" and re.search(r"→ 5\d\d", facts_text):
        severity = "HIGH"
    elif ftype in {"DATA_MISMATCH", "API_SCHEMA_MISMATCH"}:
        severity = "HIGH" if money or ftype == "API_SCHEMA_MISMATCH" else "MEDIUM"
    elif ftype in {"ELEMENT_NOT_FOUND", "TIMEOUT", "ASSERTION_FAILED", "API_ERROR"}:
        severity = "MEDIUM"
    else:
        severity = "LOW"
    if severity == "HIGH" and re.search(r"결제|주문", title):
        severity = "CRITICAL"
    causes = [
        {
            "description": h["description"],
            "evidenceIds": h["evidenceIds"],
            "confidencePct": h["confidencePct"],
            "remediation": h["remediation"],
        }
        for h in data["hints"]
    ]
    if _has(title, ANALYSIS_UNGROUNDED):
        causes.insert(
            0,
            {"description": "근거 없는 추측", "evidenceIds": ["E999"], "confidencePct": 95, "remediation": None},
        )
    if _has(title, ANALYSIS_EMPTY):
        causes = []
    ref = data.get("requirementRef")
    feature = re.sub(r"#fake-[a-z0-9-]+", "", title).strip()
    return {
        "severity": severity,
        "affectedFeatures": [f"{feature} ({ref})" if ref else feature],
        "rootCauses": causes,
    }


def register_all(client: FakeLLMClient) -> FakeLLMClient:
    client.register(AnalysisOut, analyze)
    client.register(RefinementOut, refine)
    client.register(TestQueryOut, test_query)
    client.register(ScenarioPlanOut, plan)
    client.register(ScenarioDraftOut, draft)
    return client


def make_fake_llm(dim: int = 384, delay_seconds: float = 0.0) -> FakeLLMClient:
    return register_all(FakeLLMClient(dim=dim, delay_seconds=delay_seconds))
