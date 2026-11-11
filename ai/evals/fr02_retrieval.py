"""FR-02 검색 평가: 기능 이름으로 검색하면 해당 명세가 상위 3개 안에 90% 이상.

실행 (ai/ 에서):
    .venv/bin/python evals/fr02_retrieval.py [--top-k 3] [--json 결과.json] [--min-rate 0.9]

- 코퍼스(evals/corpus)를 실제 구축 경로(KnowledgeBaseBuilder)로 임시 지식 베이스에 넣고,
  요청 정제가 쓰는 검색 함수(app.pipeline.context.retrieve)로 질의한다. 잰 값이 실제 동작과 같게 하기 위해서다.
- 임베딩은 LLM_PROVIDER 설정을 따른다. 기본값 fake(해시 임베딩)로 낸 수치는 파이프라인 동작 확인용이며
  모델 품질 수치가 아니다 (skrr-ai-pipeline references/evaluation.md 보고 규칙).
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import subprocess
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
from app.knowledge.build import BuildDocument, KnowledgeBaseBuilder  # noqa: E402
from app.knowledge.models import DocumentType  # noqa: E402
from app.knowledge.sources import LocalDocumentSource  # noqa: E402
from app.knowledge.store import KnowledgeBase, kb_path  # noqa: E402
from app.llm.client import Embedder  # noqa: E402
from app.llm.factory import build_llm_client  # noqa: E402
from app.pipeline.context import retrieve  # noqa: E402

CORPUS = AI_ROOT / "evals" / "corpus"
DATASET = AI_ROOT / "evals" / "datasets" / "fr02_retrieval.yaml"
CORPUS_FILES = (
    (DocumentType.REQUIREMENT, "requirements.md", "text/markdown"),
    (DocumentType.API_SPEC, "openapi.yaml", "application/yaml"),
    (DocumentType.CATALOG, "catalog.json", "application/json"),
)


async def build_corpus_kb(corpus: Path, kb_dir: Path, embedder: Embedder, project_id: str) -> Path:
    documents = [
        BuildDocument(
            document_id=str(uuid.uuid5(uuid.NAMESPACE_URL, name)),
            doc_type=doc_type,
            version=1,
            s3_key=name,
            content_type=content_type,
            checksum_sha256=hashlib.sha256((corpus / name).read_bytes()).hexdigest(),
        )
        for doc_type, name, content_type in CORPUS_FILES
    ]
    settings = Settings(KB_DATA_DIR=kb_dir)
    builder = KnowledgeBaseBuilder(settings, LocalDocumentSource(corpus), embedder)
    await builder.run(Job(job_id="eval", type=JobType.KB_BUILD), project_id, documents)
    return kb_path(kb_dir, project_id)


async def evaluate(
    *,
    embedder: Embedder,
    corpus: Path = CORPUS,
    dataset: Path = DATASET,
    top_k: int = 3,
) -> dict[str, Any]:
    items: list[dict[str, Any]] = yaml.safe_load(dataset.read_text(encoding="utf-8"))
    project_id = str(uuid.uuid5(uuid.NAMESPACE_URL, "skrr-eval-fr02"))
    rows: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory() as tmp:
        path = await build_corpus_kb(corpus, Path(tmp), embedder, project_id)
        with KnowledgeBase(path) as kb:
            for item in items:
                hits = await retrieve(kb, embedder, item["query"], k=top_k)
                got = [h.source_id for h in hits]
                req_only = await retrieve(kb, embedder, item["query"], k=top_k, types=[DocumentType.REQUIREMENT])
                rows.append(
                    {
                        "query": item["query"],
                        "tag": item.get("tag", "name"),
                        "expected": item["expected"],
                        "top": got,
                        "hit": any(e in got for e in item["expected"]),
                        "hitRequirementOnly": any(e in [h.source_id for h in req_only] for e in item["expected"]),
                    }
                )

    def summary(tag: str, key: str = "hit") -> dict[str, Any]:
        subset = [r for r in rows if r["tag"] == tag]
        hits = sum(1 for r in subset if r[key])
        return {"hits": hits, "total": len(subset), "rate": round(hits / len(subset), 4) if subset else None}

    return {
        "metric": "FR-02 검색 Top-K 적중률 (정답 요구사항 ID가 상위 K개 청크 안에 있음)",
        "verified": "실제 모델 미검증 (가짜 해시 임베딩)"
        if embedder.embedding_model.startswith("fake-")
        else "실제 모델",
        "samples": len(items),
        "date": datetime.now(UTC).isoformat(timespec="seconds"),
        "commit": _git_commit(),
        "embeddingModel": embedder.embedding_model,
        "topK": top_k,
        "retrieval": "app.pipeline.context.retrieve (전체 문서 유형, 코사인)",
        "corpus": str(corpus.relative_to(AI_ROOT)) if corpus.is_relative_to(AI_ROOT) else str(corpus),
        "dataset": str(dataset.relative_to(AI_ROOT)) if dataset.is_relative_to(AI_ROOT) else str(dataset),
        "name": summary("name"),
        "paraphrase": summary("paraphrase"),
        "nameRequirementOnly": summary("name", "hitRequirementOnly"),
        "failures": [r for r in rows if not r["hit"]],
        "rows": rows,
    }


def _git_commit() -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=AI_ROOT, check=True
        )
        dirty = subprocess.run(["git", "status", "--porcelain", "--", "."], capture_output=True, text=True, cwd=AI_ROOT)
        return out.stdout.strip() + ("+dirty" if dirty.stdout.strip() else "")
    except (OSError, subprocess.CalledProcessError):
        return None


def _print(report: dict[str, Any]) -> None:
    def fmt(s: dict[str, Any]) -> str:
        return f"{s['hits']}/{s['total']} ({s['rate']:.1%})" if s["total"] else "표본 없음"

    print(f"# {report['metric']}")
    print(
        f"날짜 {report['date']} · 커밋 {report['commit']} · 임베딩 {report['embeddingModel']} · topK {report['topK']}"
    )
    print(f"코퍼스 {report['corpus']} · 평가셋 {report['dataset']} ({report['samples']}건)")
    print(f"- 기능 이름(name, FR-02 기준 대상): {fmt(report['name'])}")
    print(f"- 요구사항 유형만 검색했을 때(name): {fmt(report['nameRequirementOnly'])}")
    print(f"- 바꿔 말한 요청(paraphrase, 참고): {fmt(report['paraphrase'])}")
    if report["embeddingModel"].startswith("fake-"):
        print("※ 가짜 해시 임베딩 결과다. 파이프라인 동작 확인용이며 모델 품질 수치가 아니다. 실제 모델: 미검증")
    if report["failures"]:
        print("실패 사례:")
        for r in report["failures"]:
            print(f"  [{r['tag']}] {r['query']} → 기대 {r['expected']}, 상위 {r['top']}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--top-k", type=int, default=3)
    parser.add_argument("--json", type=Path, help="결과를 JSON으로도 저장할 경로")
    parser.add_argument("--min-rate", type=float, help="name 적중률이 이 값보다 낮으면 종료 코드 1")
    args = parser.parse_args()

    report = asyncio.run(evaluate(embedder=build_llm_client(Settings()), top_k=args.top_k))
    _print(report)
    if args.json:
        args.json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    rate = report["name"]["rate"] or 0.0
    return 1 if args.min_rate is not None and rate < args.min_rate else 0


if __name__ == "__main__":
    raise SystemExit(main())
