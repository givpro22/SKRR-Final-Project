"""FR-06 원인 분석 평가: 탐지한 장애의 70% 이상에서 실제 원인을 1순위로 제시하는지.

실행 (ai/ 에서):
    .venv/bin/python evals/fr06_analysis.py [--json 결과.json] [--min-rate 0.7]

- 평가셋 evals/datasets/fr06_faults.yaml(장애별 분석 요청 + 정답 원인 키워드)을
  분석 작업 함수(run_failure_analysis)로 그대로 돌린다.
- 판정자: 자동(1순위 후보 설명에 정답 키워드 포함). 근거(evidence)가 요청 값인지도 함께 센다.
- LLM_PROVIDER=fake(기본)면 규칙 관찰을 그대로 후보로 쓰는 응답기다. 실제 모델 품질은 미검증이다.
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
from app.api.schemas import FailureAnalysisRequest  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.llm.client import LLMClient  # noqa: E402
from app.llm.factory import build_llm_client  # noqa: E402
from app.pipeline import prompts  # noqa: E402
from app.pipeline.analysis import AnalysisInput, build_facts, run_failure_analysis  # noqa: E402

sys.path.insert(0, str(AI_ROOT / "evals"))
from fr02_retrieval import CORPUS, _git_commit, build_corpus_kb  # noqa: E402

DATASET = AI_ROOT / "evals" / "datasets" / "fr06_faults.yaml"
JUDGE = "자동(1순위 후보 설명에 정답 키워드 포함)"


async def evaluate(*, llm: LLMClient, dataset: Path = DATASET) -> dict[str, Any]:
    items: list[dict[str, Any]] = yaml.safe_load(dataset.read_text(encoding="utf-8"))
    project_id = str(uuid.uuid5(uuid.NAMESPACE_URL, "skrr-eval-fr06"))
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        kb_dir = Path(tmp)
        await build_corpus_kb(CORPUS, kb_dir, llm, project_id)
        for item in items:
            request = FailureAnalysisRequest.model_validate({"projectId": project_id, **item["request"]})
            req = request.model_dump(mode="json", exclude_none=True)
            result = await run_failure_analysis(
                Job(job_id="eval", type=JobType.FAILURE_ANALYZE), AnalysisInput(project_id, req), llm, kb_dir
            )
            causes = result["rootCauses"]
            top = causes[0] if causes else None
            fact_texts = {f.text for f in build_facts(req)}
            grounded = all(e in fact_texts or e.startswith("카탈로그 요소 ") for c in causes for e in c["evidence"])
            rows.append(
                {
                    "faultId": item["faultId"],
                    "failureType": req["failureType"],
                    "expected": item["rootCause"],
                    "keywords": item["rootCauseKeywords"],
                    "top": top["description"] if top else None,
                    "pass": bool(top) and any(k in top["description"] for k in item["rootCauseKeywords"]),
                    "evidenceGrounded": grounded,
                    "severity": result["severity"],
                    "candidates": len(causes),
                }
            )
    passed = sum(1 for r in rows if r["pass"])
    return {
        "metric": "FR-06 원인 1순위 정확도 (탐지된 장애 중 1순위 후보가 실제 원인)",
        "judge": JUDGE,
        "verified": "실제 모델 미검증 (가짜 규칙 응답기)" if llm.provider == "fake" else "실제 모델",
        "date": datetime.now(UTC).isoformat(timespec="seconds"),
        "commit": _git_commit(),
        "provider": llm.provider,
        "promptVersion": prompts.FAILURE_ANALYSIS,
        "dataset": str(dataset.relative_to(AI_ROOT)) if dataset.is_relative_to(AI_ROOT) else str(dataset),
        "samples": len(rows),
        "result": {"pass": passed, "total": len(rows), "rate": round(passed / len(rows), 4) if rows else None},
        "evidenceGrounded": all(r["evidenceGrounded"] for r in rows),
        "failures": [r for r in rows if not r["pass"]],
        "rows": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", type=Path)
    parser.add_argument("--min-rate", type=float)
    args = parser.parse_args()
    report = asyncio.run(evaluate(llm=build_llm_client(Settings())))
    r = report["result"]
    print(f"# {report['metric']}")
    print(
        f"날짜 {report['date']} · 커밋 {report['commit']} · LLM {report['provider']}"
        f" · 프롬프트 {report['promptVersion']}"
    )
    print(f"평가셋 {report['dataset']} ({report['samples']}건) · 판정자 {report['judge']}")
    print(
        f"- 1순위 정답 {r['pass']}/{r['total']} ({r['rate']:.0%}) · 기준 70%"
        f" · 근거가 모두 요청 값: {report['evidenceGrounded']}"
    )
    print(f"※ {report['verified']}")
    for row in report["failures"]:
        print(f"  실패: {row['faultId']} → 1순위 '{row['top']}', 정답 {row['expected']}")
    if args.json:
        args.json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    rate = r["rate"] or 0.0
    return 1 if args.min_rate is not None and rate < args.min_rate else 0


if __name__ == "__main__":
    raise SystemExit(main())
