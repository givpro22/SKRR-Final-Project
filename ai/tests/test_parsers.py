from __future__ import annotations

from pathlib import Path

import pytest

from app.knowledge.models import DocumentParseError, DocumentType
from app.knowledge.parsers import parse_document
from app.knowledge.parsers.api_spec import parse_api_spec
from app.knowledge.parsers.catalog import parse_catalog
from app.knowledge.parsers.requirement import parse_requirement
from tests.conftest import make_docx, make_pdf

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


# --- 요구사항 ---


def test_requirement_markdown_splits_by_id_and_merges_toc(fixtures_dir: Path) -> None:
    data = (fixtures_dir / "requirements.md").read_bytes()
    parsed = parse_requirement("d1", data, "text/markdown", "requirements/p/x_requirements.md")
    ids = [r.requirement_id for r in parsed.requirements]
    assert ids == ["FR-CART-01", "FR-CART-02", "FR-ORD-01", "FR-CPN-02"]
    cart = next(c for c in parsed.chunks if c.source_id == "FR-CART-01")
    # 목차 줄과 본문이 한 청크로 합쳐지고, 본문 내용이 들어 있다.
    assert cart.title == "장바구니 담기"
    assert "재고보다 많은 수량" in cart.text
    # 머리말은 어떤 청크에도 들어가지 않는다.
    assert all("머리말" not in c.text for c in parsed.chunks)
    assert parsed.summary() == {"requirementCount": 4}
    assert cart.metadata["location"] == "줄 6"
    # 제목 줄(## 주문)은 앞 요구사항 본문에 붙지 않는다.
    assert all("## " not in c.text for c in parsed.chunks)


def test_requirement_docx_paragraphs_and_table() -> None:
    data = make_docx(
        ["요구사항 명세서", "FR-CART-01 장바구니 담기", "버튼을 누르면 담긴다."],
        table=[["ID", "이름", "설명"], ["FR-ORD-01", "주문 생성", "회원은 주문을 만든다"]],
    )
    parsed = parse_requirement("d1", data, DOCX, "a.docx")
    assert [r.requirement_id for r in parsed.requirements] == ["FR-CART-01", "FR-ORD-01"]
    order = parsed.chunks[1]
    assert order.title == "주문 생성"
    assert order.metadata["location"] == "표 1 2행"
    assert "버튼을 누르면 담긴다." in parsed.chunks[0].text


def test_requirement_pdf_records_page() -> None:
    data = make_pdf([["Requirements", "FR-CART-01: Add to cart", "Adds the item."], ["FR-ORD-01: Create order"]])
    parsed = parse_requirement("d1", data, "application/pdf", "a.pdf")
    assert [r.requirement_id for r in parsed.requirements] == ["FR-CART-01", "FR-ORD-01"]
    assert parsed.chunks[0].metadata["location"] == "1쪽"
    assert parsed.chunks[1].metadata["location"] == "2쪽"
    assert "Adds the item." in parsed.chunks[0].text


def test_requirement_without_ids_fails_with_location() -> None:
    with pytest.raises(DocumentParseError) as err:
        parse_requirement("d1", "그냥 문장만 있다.\n장바구니 기능".encode(), "text/plain", "a.txt")
    assert err.value.location == "문서 전체"
    assert "FR-CART-01" in err.value.message


def test_requirement_id_inside_sentence_is_not_a_chunk_boundary() -> None:
    text = "FR-CART-01 담기\n이 기능은 FR-ORD-01과 연결된다.\n".encode()
    parsed = parse_requirement("d1", text, "text/plain", "a.txt")
    assert [r.requirement_id for r in parsed.requirements] == ["FR-CART-01"]


def test_requirement_unsupported_format() -> None:
    with pytest.raises(DocumentParseError):
        parse_requirement("d1", b"\x89PNG", "image/png", "a.png")


def test_requirement_empty_pdf_text() -> None:
    data = make_pdf([[]])
    with pytest.raises(DocumentParseError) as err:
        parse_requirement("d1", data, "application/pdf", "a.pdf")
    assert "스캔" in err.value.message


# --- API 명세 ---


def test_api_spec_operations(fixtures_dir: Path) -> None:
    parsed = parse_api_spec("d2", (fixtures_dir / "openapi.yaml").read_bytes())
    keys = [c.source_id for c in parsed.chunks]
    assert keys == ["POST /api/auth/login", "GET /api/cart", "POST /api/cart/items", "POST /api/orders"]
    ops = {f"{o.method} {o.path}": o for o in parsed.operations}
    assert ops["GET /api/cart"].read_only is True
    assert ops["POST /api/orders"].read_only is False
    # YAML 숫자 키 상태 코드도 문자열로 정규화한다.
    assert ops["POST /api/cart/items"].status_codes == ("201", "409")
    # 작업 단위 security: []가 전역 설정을 덮어쓴다.
    assert ops["POST /api/auth/login"].security == ()
    assert ops["GET /api/cart"].security == ("bearerAuth",)
    assert parsed.raw_spec is not None and "components" in parsed.raw_spec
    assert parsed.summary() == {"endpointCount": 4}
    login = parsed.chunks[0]
    assert "응답 200: 토큰 발급 (Token)" in login.text
    assert "요청 본문: application/json (LoginRequest)" in login.text


def test_api_spec_json_is_accepted() -> None:
    data = b'{"openapi":"3.1.0","paths":{"/a":{"get":{"responses":{"200":{"description":"ok"}}}}}}'
    parsed = parse_document("d", DocumentType.API_SPEC, data, "application/json", "a.json")
    assert parsed.operations[0].path == "/a"


@pytest.mark.parametrize(
    ("data", "location"),
    [
        (b"openapi: 3.0.0\npaths: {\n  /a: [\n", "줄"),
        (b"title: no openapi\npaths: {}\n", "문서 최상위"),
        (b"openapi: 3.0.0\npaths: {}\n", "paths"),
        (b"openapi: 3.0.0\npaths:\n  /a:\n    get:\n      summary: x\n", "paths./a.get"),
    ],
)
def test_api_spec_errors(data: bytes, location: str) -> None:
    with pytest.raises(DocumentParseError) as err:
        parse_api_spec("d", data)
    assert err.value.location is not None and err.value.location.startswith(location)


def test_api_spec_rejects_pdf() -> None:
    with pytest.raises(DocumentParseError):
        parse_document("d", DocumentType.API_SPEC, b"%PDF-1.4", "application/pdf", "a.pdf")


# --- 카탈로그 ---


def test_catalog_json_groups_by_page(fixtures_dir: Path) -> None:
    parsed = parse_catalog("d3", (fixtures_dir / "catalog.json").read_bytes(), "application/json", "c.json")
    assert [c.source_id for c in parsed.chunks] == ["/products/:id", "/cart", "/checkout"]
    assert parsed.chunks[1].metadata["testIds"] == ["cart-item-qty", "cart-total"]
    assert parsed.summary() == {"elementCount": 6, "pageCount": 3}
    assert "cart-add-button: 장바구니 담기 버튼 [button] 관련 요구사항: FR-CART-01" in parsed.chunks[0].text


def test_catalog_csv(fixtures_dir: Path) -> None:
    parsed = parse_catalog("d3", (fixtures_dir / "catalog.csv").read_bytes(), "text/csv", "c.csv")
    by_id = {e.test_id: e for e in parsed.elements}
    assert by_id["cart-total"].requirement_refs == ("FR-CART-02", "FR-CART-01")
    assert by_id["header-cart-link"].page == "(공통)"


def test_catalog_missing_test_id_reports_row() -> None:
    data = "testId,page,label\ncart-add-button,/p,담기\n,/cart,합계\n".encode()
    with pytest.raises(DocumentParseError) as err:
        parse_catalog("d", data, "text/csv", "c.csv")
    assert err.value.location == "3행"


def test_catalog_json_errors() -> None:
    with pytest.raises(DocumentParseError) as err:
        parse_catalog("d", b'{"elements":[{"testId":"a"},{"label":"x"}]}', "application/json", "c.json")
    assert err.value.location == "elements[1]"
    with pytest.raises(DocumentParseError):
        parse_catalog("d", b'[{"testId":"a"}]', "application/json", "c.json")
    with pytest.raises(DocumentParseError):
        parse_catalog("d", b'{"elements":[{"testId":"a","page":"/"},{"testId":"a","page":"/"}]}', "", "c.json")


def test_catalog_splits_large_page() -> None:
    elements = ",".join(f'{{"testId":"el-{i}","page":"/big"}}' for i in range(65))
    parsed = parse_catalog("d", f'{{"elements":[{elements}]}}'.encode(), "application/json", "c.json")
    assert [c.source_id for c in parsed.chunks] == ["/big (1)", "/big (2)", "/big (3)"]
