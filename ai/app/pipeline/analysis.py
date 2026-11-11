"""실패 원인 분석 (startFailureAnalysis, FR-06, WBS 4.7, skrr-ai-pipeline §5).

    사실 정리(요청 값만, 민감한 값 가림) → 규칙 기반 관찰(hints) → LLM 원인 후보 → 근거 검사 → 정규화

- 근거(evidence)는 코드가 요청에서 만든 사실 문장(E1…)으로만 붙인다. LLM은 번호만 고르고, 없는 번호만 쓴 후보는 버린다.
  그래서 evidence 문장은 항상 요청에 실제로 있는 값이다 (성공 기준 "실제 원인 1순위"에 그럴듯한 추측은 해롭다).
- confidencePct는 합이 100을 넘지 않게 줄이고, 높은 순으로 rank를 매긴다. 최대 5개. 근거가 없으면 빈 결과도 정상이다.
- failureType은 입력이다. 바꾸거나 돌려주지 않는다.
- ELEMENT_NOT_FOUND면 지식 베이스 카탈로그에서 이름·위치가 비슷한 요소를 찾아
  "요소가 바뀌었을 가능성"을 관찰로 준다 (ADR-015).
  카탈로그 사실은 지식 베이스(대상 사이트 문서)에서 온 값이라 근거로 쓸 수 있다. 지식 베이스가 없으면 이 관찰만 빠진다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.api.jobs import Job
from app.core.errors import JobFailure
from app.knowledge.models import UiElement
from app.llm.client import LLMClient, LLMOutputInvalidError
from app.pipeline import prompts
from app.pipeline.context import Catalog, open_knowledge_base
from app.pipeline.models import AnalysisOut

MAX_ATTEMPTS = 2
MAX_CAUSES = 5
FACT_LIMIT = 300
SPEC_LIMIT = 4000

_BEARER = re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}")
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b")
_SECRET_FIELD = re.compile(
    r'(?i)("?(?:password|passwd|secret|token|accessToken|authorization)"?\s*[:=]\s*)("[^"]*"|[^\s,}]+)'
)
_TEST_ID = re.compile(r"getByTestId\(['\"]([^'\"]+)['\"]\)")
_TOKEN = re.compile(r"[0-9a-z가-힣]+")


def mask_sensitive(text: str) -> str:
    """백엔드가 TEST_DATA 비밀값을 이미 가리지만, 남을 수 있는 토큰 형태를 한 번 더 가린다."""
    text = _BEARER.sub(r"\1 ***", text)
    text = _JWT.sub("***", text)
    return _SECRET_FIELD.sub(r"\1***", text)


@dataclass
class Fact:
    id: str
    text: str
    kind: str  # FAILURE, STEP, API, VERIFY, ATTEMPT, CATALOG, SPEC


@dataclass
class Hint:
    description: str
    evidence: list[str]  # Fact.id
    confidence: int
    remediation: str


@dataclass
class AnalysisInput:
    project_id: str
    request: dict[str, Any]
    facts: list[Fact] = field(default_factory=list)


def _clip(text: str, limit: int = FACT_LIMIT) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def build_facts(req: dict[str, Any]) -> list[Fact]:
    """요청 값으로 근거가 될 사실 문장을 만든다. 모든 문장은 요청에 있는 값으로만 이뤄진다."""
    facts: list[Fact] = []

    def add(kind: str, text: str) -> str:
        fid = f"E{len(facts) + 1}"
        facts.append(Fact(fid, mask_sensitive(_clip(text)), kind))
        return fid

    add("FAILURE", f"실패 유형 {req['failureType']}: {req['failureMessage']}")
    if req.get("attempts"):
        add("ATTEMPT", f"{req.get('failedAttempts', 0)}/{req['attempts']}회 실패")
    for step in req.get("steps", []):
        parts = [f"{step['order']}단계 '{step['title']}' {step['status']}"]
        if step.get("expectedValue") is not None or step.get("actualValue") is not None:
            parts.append(f"기대 {step.get('expectedValue', '-')}, 실제 {step.get('actualValue', '-')}")
        if step.get("schemaCheck") == "FAILED":
            parts.append("응답 구조 검사 실패")
        if step.get("detail"):
            # 첫 줄(사유)과, 있으면 call log의 요소 줄(어느 요소를 기다렸는지)
            lines = [ln.strip() for ln in str(step["detail"]).split("\n") if ln.strip()]
            parts.append(lines[0])
            parts.extend(ln for ln in lines[1:] if "getByTestId" in ln)
        add("STEP", " · ".join(parts))
    for call in req.get("apiCalls", []):
        status = call.get("statusCode", "?")
        duration = f" ({call['durationMs']}ms)" if call.get("durationMs") is not None else ""
        add("API", f"{call['method']} {call['path']} → {status}{duration}")
    for v in req.get("verifications", []):
        values = ", ".join(
            f"{name} {v[key]}"
            for key, name in (("uiValue", "화면"), ("apiValue", "API"), ("dbValue", "DB"), ("expectedValue", "기대"))
            if v.get(key) is not None
        )
        add("VERIFY", f"교차 검증 '{v['itemLabel']}': {values} → {v['verdict']}")
    return facts


def _num(value: Any) -> float | None:
    if value is None:
        return None
    digits = re.sub(r"[^0-9.\-]", "", str(value))
    try:
        return float(digits) if digits not in {"", "-", "."} else None
    except ValueError:
        return None


def _similar_elements(missing: str, catalog: Catalog, requirement_ref: str | None, limit: int = 3) -> list[UiElement]:
    """이름이 비슷하고, 같은 요구사항에 걸린 요소를 앞에 둔다 (카탈로그 requirementRefs)."""

    def grams(text: str) -> set[str]:
        out: set[str] = set()
        for tok in _TOKEN.findall(text.lower().replace("-", " ")):
            out.add(tok)
            out.update(tok[i : i + 2] for i in range(len(tok) - 1))
        return out

    target = grams(missing)
    scored = []
    for el in catalog.elements:
        if el.test_id == missing:
            continue
        g = grams(f"{el.test_id} {el.label}")
        score = len(target & g) / max(1, len(target | g))
        if requirement_ref and requirement_ref in el.requirement_refs:
            score += 0.5
        if score > 0.2:
            scored.append((score, el))
    scored.sort(key=lambda x: (-x[0], x[1].test_id))
    return [el for _, el in scored[:limit]]


def rule_hints(req: dict[str, Any], facts: list[Fact], catalog: Catalog | None) -> list[Hint]:
    """실패 유형별 규칙 관찰. 근거는 이미 만든 사실 번호다."""
    ftype = req["failureType"]
    by_kind: dict[str, list[Fact]] = {}
    for f in facts:
        by_kind.setdefault(f.kind, []).append(f)
    failure_fact = by_kind["FAILURE"][0].id
    failed_steps = [f for f in by_kind.get("STEP", []) if " FAILED" in f.text]
    step_ids = [f.id for f in failed_steps[:1]]
    hints: list[Hint] = []

    if ftype == "DATA_MISMATCH":
        for f, v in zip(by_kind.get("VERIFY", []), req.get("verifications", []), strict=False):
            if v.get("verdict") != "MISMATCH":
                continue
            values = {k: _num(v.get(k)) for k in ("uiValue", "apiValue", "dbValue")}
            present = {k: x for k, x in values.items() if x is not None}
            odd = None
            if len(present) >= 3:
                for k, x in present.items():
                    others = [y for kk, y in present.items() if kk != k]
                    if all(y == others[0] for y in others) and x != others[0]:
                        odd = k
            where = {"uiValue": "화면 표시", "apiValue": "API 응답", "dbValue": "DB 저장"}.get(odd or "", "")
            if where:
                hints.append(
                    Hint(
                        f"'{v['itemLabel']}' 값이 {where}에서만 달라요. "
                        f"{where} 단계의 계산이나 변환이 틀렸을 가능성이 커요",
                        [f.id],
                        70,
                        f"{where}를 만드는 로직에서 '{v['itemLabel']}' 계산을 확인하세요",
                    )
                )
            else:
                hints.append(
                    Hint(
                        f"'{v['itemLabel']}' 값이 출처마다 다르거나 기대값과 달라요",
                        [f.id],
                        50,
                        f"'{v['itemLabel']}'의 화면·API·DB 값을 만드는 경로를 차례로 확인하세요",
                    )
                )
    elif ftype == "API_ERROR":
        bad = [f for f in by_kind.get("API", []) if re.search(r"→ (4|5)\d\d", f.text)]
        server = [f for f in bad if re.search(r"→ 5\d\d", f.text)]
        # 거부(4xx)를 기대했는데 성공(2xx)한 경우: 입력 검증·권한 검사가 빠졌다
        accepted = [
            (f, st)
            for f, st in zip(by_kind.get("STEP", []), req.get("steps", []), strict=False)
            if str(st.get("expectedValue", "")).startswith("4") and str(st.get("actualValue", "")).startswith("2")
        ]
        if accepted:
            f, st = accepted[0]
            hints.append(
                Hint(
                    f"거부({st['expectedValue']})해야 할 요청을 받아들였어요({st['actualValue']}). "
                    "입력 검증이나 권한 검사가 빠졌을 가능성이 커요",
                    [f.id],
                    75,
                    "명세의 거부 조건(범위·형식·권한)을 서버 검증 코드와 비교하세요",
                )
            )
        elif server:
            hints.append(
                Hint(
                    f"서버 오류 응답이에요 ({server[0].text}). 서버 처리 중 예외가 났을 가능성이 커요",
                    [server[0].id, *step_ids],
                    75,
                    "해당 API의 서버 로그와 예외 처리를 확인하세요",
                )
            )
        elif bad:
            hints.append(
                Hint(
                    f"기대와 다른 오류 응답이에요 ({bad[0].text}). 요청 검증·권한 규칙이 명세와 다를 수 있어요",
                    [bad[0].id, *step_ids],
                    60,
                    "명세의 상태 코드 조건과 서버의 검증·권한 규칙을 비교하세요",
                )
            )
        else:
            hints.append(
                Hint("기대한 상태 코드가 아니에요", [failure_fact, *step_ids], 40, "API 상태 코드 조건을 확인하세요")
            )
    elif ftype == "API_SCHEMA_MISMATCH":
        hints.append(
            Hint(
                "API 응답 구조가 명세와 달라요 (필드 누락이나 타입 변경)",
                [*step_ids, failure_fact] if step_ids else [failure_fact],
                75,
                "응답을 만드는 코드의 필드 이름·타입이 명세와 같은지 확인하세요",
            )
        )
    elif ftype == "ELEMENT_NOT_FOUND":
        missing = None
        for f in [*failed_steps, by_kind["FAILURE"][0]]:
            m = _TEST_ID.search(f.text)
            if m:
                missing = m.group(1)
                break
        hints.append(
            Hint(
                f"화면에서 '{missing}' 요소를 찾지 못했어요. 요소가 사라졌거나 표시 조건이 바뀌었을 수 있어요"
                if missing
                else "화면에서 요소를 찾지 못했어요",
                [*step_ids] or [failure_fact],
                55,
                "해당 화면에서 요소가 렌더링되는 조건과 data-testid를 확인하세요",
            )
        )
        if missing and catalog is not None:
            for el in _similar_elements(missing, catalog, req.get("requirementRef")):
                fid = f"E{len(facts) + 1}"
                facts.append(Fact(fid, f"카탈로그 요소 {el.test_id} ({el.label}, {el.page})", "CATALOG"))
                hints.append(
                    Hint(
                        f"요소가 바뀌었을 가능성: 비슷한 요소 '{el.test_id}'({el.label})가 카탈로그에 있어요",
                        [fid, *step_ids],
                        20,
                        "화면의 data-testid가 바뀌었다면 카탈로그와 시나리오를 함께 고치세요 (판정은 실패로 유지)",
                    )
                )
    elif ftype == "TIMEOUT":
        slow = sorted(
            (f for f in by_kind.get("API", []) if re.search(r"\((\d+)ms\)", f.text)),
            key=lambda f: -int(re.search(r"\((\d+)ms\)", f.text).group(1)),  # type: ignore[union-attr]
        )
        ev = [slow[0].id] if slow else []
        hints.append(
            Hint(
                "응답이나 화면 변화가 시간 안에 오지 않았어요" + (f" (가장 느린 호출: {slow[0].text})" if slow else ""),
                [*ev, *step_ids] or [failure_fact],
                55,
                "느린 API나 화면 로딩 조건을 확인하세요",
            )
        )
    elif ftype == "ASSERTION_FAILED":
        hints.append(
            Hint(
                "화면이나 응답 값이 기대값과 달라요" + (f" ({failed_steps[0].text})" if failed_steps else ""),
                [*step_ids] or [failure_fact],
                60,
                "기대값을 만든 요구사항과 실제 동작을 비교하세요",
            )
        )
    else:
        hints.append(
            Hint(
                "테스트 실행 환경이나 테스트 코드 문제일 수 있어요",
                [failure_fact],
                30,
                "실행 환경과 대상 접속을 확인하세요",
            )
        )

    attempts = by_kind.get("ATTEMPT", [])
    if attempts and req.get("attempts") and 0 < req.get("failedAttempts", 0) < req["attempts"]:
        hints.append(
            Hint(
                "재현 시도 중 일부만 실패했어요. 타이밍·데이터 경쟁 같은 불안정 원인일 수 있어요",
                [attempts[0].id],
                20,
                "실패한 시도와 통과한 시도의 차이(응답 시간, 데이터)를 비교하세요",
            )
        )
    return hints


def ground_and_rank(out: AnalysisOut, facts: list[Fact]) -> list[dict[str, Any]]:
    """근거 검사와 정규화. 사실 번호가 하나도 맞지 않는 후보는 버린다."""
    by_id = {f.id: f for f in facts}
    kept = []
    for cause in out.rootCauses:
        evidence = [by_id[i].text for i in dict.fromkeys(cause.evidenceIds) if i in by_id]
        if not evidence or not cause.description.strip():
            continue
        kept.append((max(0, min(100, cause.confidencePct)), cause, evidence))
    kept.sort(key=lambda x: -x[0])
    kept = kept[:MAX_CAUSES]
    total = sum(c for c, _, _ in kept)
    scale = 100 / total if total > 100 else 1.0
    result = []
    for rank, (conf, cause, evidence) in enumerate(kept, start=1):
        item: dict[str, Any] = {
            "rank": rank,
            "description": mask_sensitive(cause.description.strip()),
            "confidencePct": int(conf * scale),
            "evidence": evidence,
        }
        if cause.remediation and cause.remediation.strip():
            item["remediation"] = mask_sensitive(cause.remediation.strip())
        result.append(item)
    return result


async def run_failure_analysis(job: Job, inp: AnalysisInput, llm: LLMClient, kb_dir: Path) -> dict[str, Any]:
    req = inp.request
    job.set_progress("RETRIEVE", 5, f"{req['caseCode']} 실패 근거를 정리하고 있어요")
    facts = build_facts(req)
    catalog: Catalog | None = None
    try:
        with open_knowledge_base(kb_dir, inp.project_id) as kb:
            catalog = Catalog.load(kb)
    except JobFailure:
        catalog = None  # 지식 베이스가 없어도 분석은 한다 (비슷한 요소 관찰만 빠진다)
    hints = rule_hints(req, facts, catalog)
    data = {
        "caseCode": req["caseCode"],
        "caseTitle": req["caseTitle"],
        "requirementRef": req.get("requirementRef"),
        "expectedResult": req["expectedResult"],
        "failureType": req["failureType"],
        "facts": [{"id": f.id, "kind": f.kind, "text": f.text} for f in facts],
        "hints": [
            {
                "description": h.description,
                "evidenceIds": h.evidence,
                "confidencePct": h.confidence,
                "remediation": h.remediation,
            }
            for h in hints
        ],
        "specSource": mask_sensitive(str(req.get("specSource") or ""))[:SPEC_LIMIT],
        "feedback": None,
    }
    last_error = ""
    for attempt in range(1, MAX_ATTEMPTS + 1):
        job.set_progress(
            "GENERATE", 20 + 30 * (attempt - 1), "원인 후보를 찾고 있어요", attempt=attempt, max_attempts=MAX_ATTEMPTS
        )
        try:
            out = await llm.generate_json(
                system=prompts.system_prompt(prompts.FAILURE_ANALYSIS),
                user=prompts.user_message(data),
                schema=AnalysisOut,
            )
        except LLMOutputInvalidError as exc:
            last_error = exc.message
            data["feedback"] = [f"출력 형식이 맞지 않아요: {exc.message[:200]}"]
            continue
        job.set_progress("GUARD", 80, "원인 후보의 근거를 확인하고 있어요")
        causes = ground_and_rank(out, facts)
        features = [mask_sensitive(f.strip()) for f in out.affectedFeatures if f.strip()]
        ref = req.get("requirementRef")
        if ref and not any(ref in f for f in features):
            features.insert(0, f"{req['caseTitle']} ({ref})")
        return {
            "kind": "FAILURE_ANALYZE",
            "severity": out.severity,
            "affectedFeatures": list(dict.fromkeys(features)),
            "rootCauses": causes,
        }
    raise LLMOutputInvalidError(f"분석 결과 형식이 {MAX_ATTEMPTS}번 모두 맞지 않았어요: {last_error[:300]}")
