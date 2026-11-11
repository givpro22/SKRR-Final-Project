"""시나리오·케이스 생성 (startScenarioGeneration, FR-03, WBS 4.5.3~4.5.5, ADR-017).

흐름 (skrr-ai-pipeline §3의 그래프를 그대로 코드로 둔다):

    retrieve → plan → (시나리오마다) generate → guard ─ 통과 → 결과
                                              ├ 실패 → 피드백 주입 → generate (최대 3회)
                                              └ CATALOG_GAP → 재생성 없이 종료

결과는 작업이 끝난 뒤 한꺼번에 돌려준다 (U2). 진행 중에는 progress.scenarioCode·attempt·message만 갱신한다.
시나리오·케이스 코드, 근거(Reference)는 코드가 붙이고 LLM이 쓰지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

from pydantic import BaseModel, ConfigDict

from app.api.jobs import Job
from app.core.codes import GuardFailureKind
from app.guards.scenario import (
    GuardFailure,
    case_references,
    check_scenario,
    escalate_catalog_gap,
    progress_message,
    schema_invalid,
)
from app.knowledge.models import DocumentType
from app.knowledge.retrieval import RetrievedChunk, search_by_vector
from app.llm.client import LLMClient, LLMOutputInvalidError
from app.pipeline import prompts
from app.pipeline.context import Catalog, open_knowledge_base, query_vector, score_all
from app.pipeline.models import CaseOut, ScenarioDraftOut, ScenarioPlanItemOut, ScenarioPlanOut, ScopeOut

MAX_ATTEMPTS = 3
MAX_SCENARIOS = 5
RETRIEVE_K = 8
CHUNK_TEXT_LIMIT = 1500
LIST_LIMIT = 300
# 백엔드 저장 한도 (scenario.title, test_case.title VARCHAR(200))
TITLE_LIMIT = 200
SCOPE_ORDER = ("UI", "API", "DB")


class PreviousScenario(BaseModel):
    """재생성 요청의 previous. 계약 GeneratedScenario 중 프롬프트에 쓰는 부분만 읽는다."""

    model_config = ConfigDict(extra="ignore")

    title: str = ""
    requirementRef: str | None = None
    scopes: list[str] = []
    testCases: list[dict[str, Any]] = []


@dataclass(frozen=True)
class Regenerate:
    scenario_code: str
    previous: PreviousScenario | None
    feedback: str | None


@dataclass(frozen=True)
class GenerationInput:
    project_id: str
    test_request_code: str
    request_text: str
    first_scenario_number: int = 1
    first_case_number: int = 1
    regenerate: Regenerate | None = None


@dataclass
class _ScenarioOutcome:
    code: str
    plan: ScenarioPlanItemOut
    draft: ScenarioDraftOut | None
    passed: bool
    attempts: int
    failures: list[GuardFailure] = field(default_factory=list)


def code(prefix: str, number: int) -> str:
    return f"{prefix}-{number:02d}"


def _sorted_scopes(scopes: list[str]) -> list[str]:
    return [s for s in SCOPE_ORDER if s in set(scopes)]


def _chunk_data(chunks: list[RetrievedChunk]) -> list[dict[str, Any]]:
    return [
        {
            "sourceType": c.source_type.value,
            "sourceId": c.source_id,
            "title": c.title,
            "text": c.text[:CHUNK_TEXT_LIMIT],
        }
        for c in chunks
    ]


def _catalog_data(catalog: Catalog) -> dict[str, Any]:
    return {
        "requirements": [{"id": r.requirement_id, "title": r.title} for r in catalog.requirements.values()][
            :LIST_LIMIT
        ],
        "apiOperations": [
            {
                "operation": f"{o.method} {o.path}",
                "summary": o.summary,
                "statusCodes": list(o.status_codes),
                "readOnly": o.read_only,
            }
            for o in catalog.operations
        ][:LIST_LIMIT],
        "catalogElements": [
            {
                "testId": e.test_id,
                "page": e.page,
                "label": e.label,
                "type": e.element_type,
                "requirementRefs": list(e.requirement_refs),
            }
            for e in catalog.elements
        ][:LIST_LIMIT],
    }


class ScenarioGenerator:
    def __init__(self, llm: LLMClient, kb_dir: Path) -> None:
        self._llm = llm
        self._kb_dir = kb_dir

    async def run(self, job: Job, inp: GenerationInput) -> dict[str, Any]:
        job.set_progress("RETRIEVE", 3, "명세에서 관련 내용을 찾고 있어요")
        with open_knowledge_base(self._kb_dir, inp.project_id) as kb:
            vector = await query_vector(kb, self._llm, inp.request_text)
            retrieved = search_by_vector(kb, vector, k=RETRIEVE_K)
            scores = score_all(kb, vector)
            catalog = Catalog.load(kb)
        shared = {"requestText": inp.request_text, "retrieved": _chunk_data(retrieved), **_catalog_data(catalog)}

        plans, codes = await self._plan(job, inp, shared)
        outcomes: list[_ScenarioOutcome] = []
        total = len(plans)
        for index, (plan, sc_code) in enumerate(zip(plans, codes, strict=True)):
            outcomes.append(await self._generate_one(job, inp, shared, catalog, plan, sc_code, index, total))

        job.set_progress("GUARD", 100, f"시나리오 {total}개를 만들었어요", attempt=None, max_attempts=MAX_ATTEMPTS)
        job.progress.scenario_code = None
        return self._result(outcomes, catalog, scores, inp.first_case_number)

    # --- plan ---

    async def _plan(
        self, job: Job, inp: GenerationInput, shared: dict[str, Any]
    ) -> tuple[list[ScenarioPlanItemOut], list[str]]:
        if inp.regenerate is not None:
            prev = inp.regenerate.previous
            scopes = [s for s in (prev.scopes if prev else []) if s in SCOPE_ORDER] or ["UI", "API"]
            plan = ScenarioPlanItemOut(
                title=(prev.title if prev and prev.title else inp.request_text[:80]),
                requirementRef=prev.requirementRef if prev else None,
                scopes=cast(list[ScopeOut], scopes),
                focus=inp.regenerate.feedback or "기존 시나리오를 다시 만든다",
            )
            return [plan], [inp.regenerate.scenario_code]

        job.set_progress("PLAN", 8, "시나리오 구성을 정하고 있어요")
        out = await self._llm.generate_json(
            system=prompts.system_prompt(prompts.SCENARIO_PLAN),
            user=prompts.user_message({**shared, "maxScenarios": MAX_SCENARIOS}),
            schema=ScenarioPlanOut,
        )
        plans = out.scenarios[:MAX_SCENARIOS]
        if not plans:
            raise LLMOutputInvalidError("요청에서 만들 시나리오를 찾지 못했어요")
        codes = [code("SC", inp.first_scenario_number + i) for i in range(len(plans))]
        return plans, codes

    # --- generate ↔ guard ---

    def _scenario_context(self, catalog: Catalog, plan: ScenarioPlanItemOut, shared: dict[str, Any]) -> dict[str, Any]:
        ref = plan.requirementRef
        related_elements = catalog.elements_for_requirement(ref) if ref else []
        retrieved_apis = [r["sourceId"] for r in shared["retrieved"] if r["sourceType"] == DocumentType.API_SPEC.value]
        # 요약에 요구사항 ID가 적힌 작업을 우선하고, 없으면 요청 검색에 걸린 작업을 쓴다.
        mentioned = [op for op in catalog.operations if ref is not None and ref in (op.summary or "")]
        fallback = [op for op in catalog.operations if f"{op.method} {op.path}" in retrieved_apis]
        related_apis = [
            {"operation": f"{op.method} {op.path}", "summary": op.summary, "statusCodes": list(op.status_codes)}
            for op in (mentioned or fallback)
        ]
        return {
            "requirementText": catalog.requirement_text(ref) if ref else "",
            "relatedElements": [
                {"testId": e.test_id, "page": e.page, "label": e.label, "type": e.element_type}
                for e in related_elements
            ],
            "relatedApis": related_apis,
        }

    async def _generate_one(
        self,
        job: Job,
        inp: GenerationInput,
        shared: dict[str, Any],
        catalog: Catalog,
        plan: ScenarioPlanItemOut,
        sc_code: str,
        index: int,
        total: int,
    ) -> _ScenarioOutcome:
        base = 15 + int(80 * index / total)
        span = 80 / total
        job.progress.scenario_code = sc_code
        data: dict[str, Any] = {
            **shared,
            "plan": plan.model_dump(),
            "scenarioCode": sc_code,
            "scenarioIndex": index,
            **self._scenario_context(catalog, plan, shared),
            "userFeedback": inp.regenerate.feedback if inp.regenerate else None,
            "previous": inp.regenerate.previous.model_dump() if inp.regenerate and inp.regenerate.previous else None,
            "feedback": None,
            "attempt": 1,
        }
        previous_failures: list[GuardFailure] = []
        draft: ScenarioDraftOut | None = None
        failures: list[GuardFailure] = []
        for attempt in range(1, MAX_ATTEMPTS + 1):
            # 첫 시도는 생성 중, 이후는 직전 가드 실패 사유 ("카탈로그에 … 없어 재생성 중", 접두어·회차는 화면이 붙임)
            message = f"{sc_code} 시나리오를 만들고 있어요" if attempt == 1 else progress_message(previous_failures)
            job.set_progress(
                "GENERATE",
                base + int(span * (attempt - 1) / MAX_ATTEMPTS),
                message,
                attempt=attempt,
                max_attempts=MAX_ATTEMPTS,
            )
            data["attempt"] = attempt
            try:
                candidate = await self._llm.generate_json(
                    system=prompts.system_prompt(prompts.SCENARIO_DRAFT),
                    user=prompts.user_message(data),
                    schema=ScenarioDraftOut,
                )
            except LLMOutputInvalidError as exc:
                failures = [schema_invalid(exc.message)]
            else:
                # 스키마를 통과한 마지막 출력을 남긴다 (3회 실패해도 사용자가 보고 재생성할 수 있게).
                draft = candidate
                job.set_progress(
                    "GUARD", base + int(span * attempt / MAX_ATTEMPTS) - 1, f"{sc_code} 가드 검사 중이에요"
                )
                failures = escalate_catalog_gap(check_scenario(candidate, catalog), previous_failures)
            if not failures:
                return _ScenarioOutcome(sc_code, plan, draft, True, attempt, [])
            if any(f.kind is GuardFailureKind.CATALOG_GAP for f in failures):
                return _ScenarioOutcome(sc_code, plan, draft, False, attempt, failures)
            previous_failures = failures
            data["feedback"] = [f.message for f in failures]
        return _ScenarioOutcome(sc_code, plan, draft, False, MAX_ATTEMPTS, failures)

    # --- result ---

    def _result(
        self,
        outcomes: list[_ScenarioOutcome],
        catalog: Catalog,
        scores: dict[tuple[str, str], float],
        first_case_number: int,
    ) -> dict[str, Any]:
        next_case = first_case_number
        scenarios = []
        for oc in outcomes:
            cases: list[dict[str, Any]] = []
            draft = oc.draft
            scopes: list[str] = list(oc.plan.scopes)
            title = oc.plan.title
            if draft is not None:
                title = draft.title.strip() or title
                scopes = [*draft.scopes]
                for case in draft.cases:
                    scopes.extend(case.scopes)
                    cases.append(_case_contract(case, code("TC", next_case)))
                    next_case += 1
            scenarios.append(
                {
                    "code": oc.code,
                    "title": title[:TITLE_LIMIT],
                    "requirementRef": draft.requirementRef if draft is not None else oc.plan.requirementRef,
                    "scopes": _sorted_scopes(scopes),
                    "references": _references(oc, draft, catalog, scores),
                    "guard": {
                        "passed": oc.passed,
                        "attempts": oc.attempts,
                        # 마지막 시도의 실패만 둔다. 통과했으면 빈 배열.
                        # catalogGap은 CATALOG_GAP 포함 여부로 백엔드가 계산한다.
                        "failures": [f.to_contract() for f in oc.failures],
                    },
                    "testCases": cases,
                }
            )
        return {"kind": "SCENARIO_GENERATE", "scenarios": scenarios}


def _case_contract(case: CaseOut, case_code: str) -> dict[str, Any]:
    expected_values = []
    for ev in case.expectedValues:
        if ev.consistencyOnly:
            expected_values.append(
                {"label": ev.label.strip(), "consistencyOnly": True, "reason": (ev.reason or "").strip()}
            )
        else:
            expected_values.append({"label": ev.label.strip(), "expected": (ev.expected or "").strip()})
    return {
        "code": case_code,
        "title": case.title.strip()[:TITLE_LIMIT],
        "type": case.type,
        "scopes": _sorted_scopes(list(case.scopes)),
        "preconditions": [p.strip() for p in case.preconditions if p.strip()],
        "steps": [s.strip() for s in case.steps if s.strip()],
        "expectedResult": case.expectedResult.strip(),
        "expectedValues": expected_values,
    }


def _references(
    oc: _ScenarioOutcome,
    draft: ScenarioDraftOut | None,
    catalog: Catalog,
    scores: dict[tuple[str, str], float],
) -> list[dict[str, Any]]:
    """시나리오가 실제로 쓴 명세(요구사항, API, 카탈로그 화면)만 근거로 붙인다. 없는 것은 넣지 않는다."""
    rows: list[dict[str, Any]] = []
    ref = draft.requirementRef if draft is not None else oc.plan.requirementRef
    if ref:
        row = catalog.chunk_for(DocumentType.REQUIREMENT, ref)
        if row:
            rows.append(row)
    if draft is not None:
        for case in draft.cases:
            test_ids, apis = case_references(case)
            for api in apis:
                method, _, path = api.partition(" ")
                op = catalog.find_operation(method, path.strip())
                if op:
                    row = catalog.chunk_for(DocumentType.API_SPEC, f"{op.method} {op.path}")
                    if row:
                        rows.append(row)
            for test_id in test_ids:
                row = catalog.catalog_chunk_for_test_id(test_id)
                if row:
                    rows.append(row)
    seen: set[tuple[str, str]] = set()
    refs = []
    for row in rows:
        key = (row["sourceType"], row["sourceId"])
        if key in seen:
            continue
        seen.add(key)
        text = " ".join(str(row["text"]).split())
        refs.append(
            {
                "sourceType": row["sourceType"],
                "sourceId": row["sourceId"],
                "title": row["title"],
                "excerpt": text if len(text) <= 300 else text[:299] + "…",
                "score": round(scores.get(key, 0.0), 4),
            }
        )
    return refs
