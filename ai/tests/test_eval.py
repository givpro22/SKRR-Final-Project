"""FR-02 평가 스크립트가 실제 검색 경로로 돌아가는지 (가짜 임베딩 회귀 확인. 품질 수치 아님)."""

from __future__ import annotations

from evals.fr02_retrieval import evaluate
from tests.conftest import fake_llm


async def test_fr02_eval_runs_on_corpus() -> None:
    report = await evaluate(embedder=fake_llm(), top_k=3)
    assert report["embeddingModel"].startswith("fake-")
    assert report["name"]["total"] == 30 and report["paraphrase"]["total"] == 8
    # 가짜 해시 임베딩에서의 회귀 기준. 이 값이 떨어지면 파서·청킹·검색 경로가 바뀐 것이다.
    assert report["name"]["rate"] >= 0.9
    assert all(len(r["top"]) == 3 for r in report["rows"])


async def test_fr03_eval_runs_refinement_pipeline() -> None:
    from evals.fr03_refinement import evaluate as evaluate_fr03

    report = await evaluate_fr03(llm=fake_llm())
    assert report["samples"] == 10
    assert report["verified"].startswith("실제 모델 미검증")
    assert report["judge"].startswith("자동(근거 일치")
    assert all(r["candidates"] and r["humanVerdict"] is None for r in report["rows"])


def test_corpus_docx_is_reproducible_and_matches_markdown() -> None:
    """evals/corpus/requirements.docx는 build_docx.py로 md에서 만든 결과와 바이트까지 같고, 같은 청크로 파싱된다."""
    from app.knowledge.parsers.requirement import parse_requirement
    from evals.corpus.build_docx import SOURCE, TARGET, build

    markdown = SOURCE.read_text(encoding="utf-8")
    data = build(markdown)
    assert data == build(markdown), "같은 입력이면 같은 바이트"
    assert TARGET.read_bytes() == data, (
        "저장된 DOCX가 md와 다르다: .venv/bin/python evals/corpus/build_docx.py로 다시 만든다"
    )
    docx_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    from_docx = parse_requirement("d", data, docx_type, "requirements.docx")
    from_md = parse_requirement("m", markdown.encode(), "text/markdown", "requirements.md")
    assert [(c.source_id, c.title, c.text) for c in from_docx.chunks] == [
        (c.source_id, c.title, c.text) for c in from_md.chunks
    ]


async def test_fr06_eval_runs_analysis_pipeline() -> None:
    from evals.fr06_analysis import evaluate as evaluate_fr06

    report = await evaluate_fr06(llm=fake_llm())
    assert report["samples"] == 10
    assert report["evidenceGrounded"] is True
    assert report["verified"].startswith("실제 모델 미검증")
    # 가짜 규칙 응답기 회귀 기준. 품질 수치가 아니다
    assert report["result"]["rate"] >= 0.7
