"""FR-03 요청 정제 평가: 모호한 요청 10건 중 8건 이상이 올바른 명세로 정제되는지.

실행 (ai/ 에서):
    .venv/bin/python evals/fr03_refinement.py [--json 결과.json] [--min-rate 0.8]

- 코퍼스(evals/corpus)를 실제 구축 경로로 넣고, 요청 정제 작업 함수(app.pipeline.refine.run_refinement)를 그대로 부른다.
- 판정자: "자동(근거 일치)" = 첫 번째 후보의 근거에 기대 요구사항 ID가 있음. 사람 판정은 JSON의 후보 문장으로 따로 한다.
- LLM_PROVIDER=fake(기본)면 규칙 응답기 결과다. 파이프라인 동작 확인용이며 실제 모델 품질은 미검증이다.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

AI_ROOT = Path(__file__).resolve().parents[1]
if str(AI_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_ROOT))

from app.api.jobs import Job, JobType  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.core.errors import JobFailure  # noqa: E402
from app.llm.client import LLMClient, LLMError  # noqa: E402
from app.llm.factory import build_llm_client  # noqa: E402
from app.pipeline import prompts  # noqa: E402
from app.pipeline.refine import RefinementInput, run_refinement  # noqa: E402

sys.path.insert(0, str(AI_ROOT / "evals"))
from fr02_retrieval import CORPUS, _git_commit, build_corpus_kb  # noqa: E402

DATASET = AI_ROOT / "evals" / "datasets" / "fr03_refinement.yaml"
JUDGE = "자동(근거 일치: 첫 후보의 근거에 기대 요구사항 ID 포함)"


async def evaluate(*, llm: LLMClient, dataset: Path = DATASET, top_k: int = 3, candidates: int = 4) -> dict[str, Any]:
    items: list[dict[str, Any]] = yaml.safe_load(dataset.read_text(encoding="utf-8"))
    project_id = str(uuid.uuid5(uuid.NAMESPACE_URL, "skrr-eval-fr03"))
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        kb_dir = Path(tmp)
        await build_corpus_kb(CORPUS, kb_dir, llm, project_id)
        for item in items:
            job = Job(job_id="eval", type=JobType.REQUEST_REFINE)
            inp = RefinementInput(project_id, item["request"], candidate_count=candidates, top_k=top_k)
            try:
                result = await run_refinement(job, inp, llm, kb_dir)
                cands = result["candidates"]
                error = None
            except (JobFailure, LLMError) as exc:
                cands, error = [], f"{exc.code}: {exc.message}"
            first_refs = [r["sourceId"] for r in cands[0]["references"]] if cands else []
            rows.append(
                {
                    "request": item["request"],
                    "expected": item["expected"],
                    "criterion": item.get("criterion"),
                    "pass": any(e in first_refs for e in item["expected"]),
                    "firstCandidate": cands[0]["refinedText"] if cands else None,
                    "firstReferences": first_refs,
                    "candidates": [c["refinedText"] for c in cands],
                    "error": error,
                    "humanVerdict": None,
                }
            )
    passed = sum(1 for r in rows if r["pass"])
    fake = llm.provider == "fake"
    return {
        "metric": "FR-03 요청 정제: 모호한 요청이 올바른 명세로 정제된 비율",
        "judge": JUDGE,
        "verified": "실제 모델 미검증 (가짜 규칙 응답기)" if fake else "실제 모델",
        "date": datetime.now(UTC).isoformat(timespec="seconds"),
        "commit": _git_commit(),
        "provider": llm.provider,
        "embeddingModel": llm.embedding_model,
        "promptVersion": prompts.REFINE,
        "topK": top_k,
        "candidateCount": candidates,
        "dataset": str(dataset.relative_to(AI_ROOT)) if dataset.is_relative_to(AI_ROOT) else str(dataset),
        "samples": len(rows),
        "result": {"pass": passed, "total": len(rows), "rate": round(passed / len(rows), 4) if rows else None},
        "failures": [r for r in rows if not r["pass"]],
        "rows": rows,
    }


def _print(report: dict[str, Any]) -> None:
    r = report["result"]
    print(f"# {report['metric']}")
    print(
        f"날짜 {report['date']} · 커밋 {report['commit']} · LLM {report['provider']}"
        f" · 임베딩 {report['embeddingModel']} · 프롬프트 {report['promptVersion']} · topK {report['topK']}"
    )
    print(f"평가셋 {report['dataset']} ({report['samples']}건) · 판정자 {report['judge']}")
    print(f"- 통과 {r['pass']}/{r['total']} ({r['rate']:.0%}) · 기준 8/10")
    print(f"※ {report['verified']}")
    for row in report["failures"]:
        print(
            f"  실패: {row['request']} → 기대 {row['expected']},"
            f" 첫 후보 근거 {row['firstReferences']} {row['error'] or ''}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", type=Path, help="결과를 JSON으로도 저장 (사람 판정용 humanVerdict 칸 포함)")
    parser.add_argument("--min-rate", type=float)
    args = parser.parse_args()
    report = asyncio.run(evaluate(llm=build_llm_client(Settings())))
    _print(report)
    if args.json:
        args.json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    rate = report["result"]["rate"] or 0.0
    return 1 if args.min_rate is not None and rate < args.min_rate else 0


if __name__ == "__main__":
    raise SystemExit(main())
