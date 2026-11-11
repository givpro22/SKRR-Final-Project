"""요청 정제 (startRequestRefinement, FR-02, WBS 4.5.3).

검색(Top K) → LLM 후보 N개 → 근거 가드(검색 결과에 있는 sourceId만) → Reference는 코드가 붙인다.
근거 가드에 걸리면 사유를 붙여 최대 3번까지 다시 만든다. 그래도 안 되면 INVALID_LLM_OUTPUT.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.api.jobs import Job
from app.knowledge.retrieval import RetrievedChunk
from app.llm.client import LLMClient, LLMOutputInvalidError
from app.pipeline import prompts
from app.pipeline.context import open_knowledge_base, retrieve
from app.pipeline.models import RefinementOut

MAX_ATTEMPTS = 3
CHUNK_TEXT_LIMIT = 1200


@dataclass(frozen=True)
class RefinementInput:
    project_id: str
    text: str
    candidate_count: int = 4
    top_k: int = 3


def _reference_data(chunks: list[RetrievedChunk]) -> list[dict[str, Any]]:
    return [
        {
            "sourceType": c.source_type.value,
            "sourceId": c.source_id,
            "title": c.title,
            "score": round(c.score, 4),
            "text": c.text[:CHUNK_TEXT_LIMIT],
        }
        for c in chunks
    ]


def _problems(out: RefinementOut, allowed: set[str]) -> list[str]:
    problems: list[str] = []
    if not out.candidates:
        problems.append("후보가 하나도 없어요")
    for i, cand in enumerate(out.candidates, start=1):
        if not cand.refinedText.strip():
            problems.append(f"{i}번째 후보 문장이 비어 있어요")
        if not cand.referenceIds:
            problems.append(f"{i}번째 후보에 근거(referenceIds)가 없어요")
        unknown = [r for r in cand.referenceIds if r not in allowed]
        if unknown:
            problems.append(f"{i}번째 후보가 검색 결과에 없는 근거 {', '.join(unknown)}를 썼어요")
    return problems


async def run_refinement(job: Job, inp: RefinementInput, llm: LLMClient, kb_dir: Path) -> dict[str, Any]:
    job.set_progress("RETRIEVE", 5, "명세에서 관련 내용을 찾고 있어요")
    with open_knowledge_base(kb_dir, inp.project_id) as kb:
        chunks = await retrieve(kb, llm, inp.text, k=inp.top_k)
    by_id = {c.source_id: c for c in chunks}

    data: dict[str, Any] = {
        "requestText": inp.text,
        "candidateCount": inp.candidate_count,
        "references": _reference_data(chunks),
        "feedback": None,
    }
    last_problems: list[str] = []
    for attempt in range(1, MAX_ATTEMPTS + 1):
        job.set_progress(
            "GENERATE",
            20 + 25 * (attempt - 1),
            "요청을 명세에 맞게 다듬고 있어요",
            attempt=attempt,
            max_attempts=MAX_ATTEMPTS,
        )
        try:
            out = await llm.generate_json(
                system=prompts.system_prompt(prompts.REFINE),
                user=prompts.user_message(data),
                schema=RefinementOut,
            )
        except LLMOutputInvalidError as exc:
            last_problems = [f"출력 형식이 맞지 않아요: {exc.message[:200]}"]
        else:
            job.set_progress("GUARD", 30 + 25 * (attempt - 1), "후보의 근거를 확인하고 있어요")
            last_problems = _problems(out, set(by_id))
            if not last_problems:
                return _result(out, by_id, inp.candidate_count)
        data["feedback"] = last_problems
    raise LLMOutputInvalidError(
        f"근거가 확인된 후보를 {MAX_ATTEMPTS}번 시도해도 만들지 못했어요: {'; '.join(last_problems)}"
    )


def _result(out: RefinementOut, by_id: dict[str, RetrievedChunk], limit: int) -> dict[str, Any]:
    """ai-api.openapi.yaml RefinementResult. Reference의 점수·발췌는 검색 결과에서 코드가 채운다."""
    candidates = []
    for cand in out.candidates[:limit]:
        refs = [by_id[r].to_reference() for r in dict.fromkeys(cand.referenceIds)]
        candidates.append({"refinedText": cand.refinedText.strip(), "references": refs})
    return {"kind": "REQUEST_REFINE", "candidates": candidates}
