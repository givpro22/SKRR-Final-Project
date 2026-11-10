"""API 명세서(OpenAPI YAML·JSON) 파서: 엔드포인트 1개 = 청크 1개."""

from __future__ import annotations

import json
from typing import Any

import yaml

from app.knowledge.models import ApiOperation, Chunk, DocumentParseError, DocumentType, ParsedDocument
from app.knowledge.parsers.text_extract import decode_text

HTTP_METHODS = ("get", "put", "post", "delete", "patch", "head", "options", "trace")
READ_ONLY_METHODS = {"GET", "HEAD", "OPTIONS"}


def _load(data: bytes) -> dict[str, Any]:
    text = decode_text(data)
    try:
        loaded = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        where = f"줄 {mark.line + 1}" if mark is not None else "문서 전체"
        raise DocumentParseError("YAML·JSON 문법 오류가 있어요", where) from exc
    if not isinstance(loaded, dict):
        raise DocumentParseError("OpenAPI 문서가 아니에요 (최상위가 객체가 아님)", "문서 전체")
    # 날짜 값과 숫자 키를 JSON 형태로 정규화해 그대로 저장할 수 있게 한다.
    normalized: dict[str, Any] = json.loads(json.dumps(loaded, default=str))
    return normalized


def _ref_name(schema: Any) -> str | None:
    if isinstance(schema, dict):
        ref = schema.get("$ref")
        if isinstance(ref, str):
            return ref.rsplit("/", 1)[-1]
        if schema.get("type") == "array":
            inner = _ref_name(schema.get("items"))
            return f"{inner}[]" if inner else None
    return None


def _security_names(op: dict[str, Any], spec: dict[str, Any]) -> tuple[str, ...]:
    security = op.get("security", spec.get("security", []))
    names: list[str] = []
    if isinstance(security, list):
        for req in security:
            if isinstance(req, dict):
                names.extend(str(k) for k in req)
    return tuple(dict.fromkeys(names))


def _operation_text(method: str, path: str, op: dict[str, Any], security: tuple[str, ...]) -> str:
    lines = [f"{method} {path}"]
    if op.get("operationId"):
        lines.append(f"operationId: {op['operationId']}")
    if op.get("summary"):
        lines.append(f"요약: {op['summary']}")
    if op.get("description"):
        lines.append(f"설명: {str(op['description']).strip()}")
    params = op.get("parameters") or []
    names = [f"{p.get('name')}({p.get('in')})" for p in params if isinstance(p, dict) and p.get("name")]
    if names:
        lines.append("파라미터: " + ", ".join(names))
    body = op.get("requestBody")
    if isinstance(body, dict):
        content = body.get("content") or {}
        parts = []
        for media, media_obj in content.items():
            name = _ref_name(media_obj.get("schema")) if isinstance(media_obj, dict) else None
            parts.append(f"{media}{f' ({name})' if name else ''}")
        if parts:
            lines.append("요청 본문: " + ", ".join(parts))
    responses = op.get("responses") or {}
    if isinstance(responses, dict):
        for code, resp in responses.items():
            desc = resp.get("description", "") if isinstance(resp, dict) else ""
            schema_name = None
            if isinstance(resp, dict):
                for media_obj in (resp.get("content") or {}).values():
                    if isinstance(media_obj, dict):
                        schema_name = _ref_name(media_obj.get("schema"))
                        break
            lines.append(f"응답 {code}: {desc}{f' ({schema_name})' if schema_name else ''}".rstrip())
    lines.append("인증: " + (", ".join(security) if security else "없음"))
    return "\n".join(lines)


def parse_api_spec(document_id: str, data: bytes) -> ParsedDocument:
    spec = _load(data)
    if "openapi" not in spec and "swagger" not in spec:
        raise DocumentParseError("openapi 버전 필드가 없어요. OpenAPI 3 형식으로 작성해 주세요", "문서 최상위")
    paths = spec.get("paths")
    if not isinstance(paths, dict) or not paths:
        raise DocumentParseError("paths에 엔드포인트가 없어요", "paths")

    chunks: list[Chunk] = []
    operations: list[ApiOperation] = []
    for path, item in paths.items():
        if not isinstance(item, dict):
            raise DocumentParseError("경로 항목이 객체가 아니에요", f"paths.{path}")
        for method_lower in HTTP_METHODS:
            op = item.get(method_lower)
            if op is None:
                continue
            if not isinstance(op, dict):
                raise DocumentParseError("작업 정의가 객체가 아니에요", f"paths.{path}.{method_lower}")
            method = method_lower.upper()
            responses = op.get("responses")
            if not isinstance(responses, dict) or not responses:
                raise DocumentParseError("상태 코드별 응답(responses)이 없어요", f"paths.{path}.{method_lower}")
            security = _security_names(op, spec)
            operation = ApiOperation(
                method=method,
                path=str(path),
                operation_id=op.get("operationId"),
                summary=op.get("summary"),
                read_only=method in READ_ONLY_METHODS,
                status_codes=tuple(str(c) for c in responses),
                security=security,
            )
            operations.append(operation)
            chunks.append(
                Chunk(
                    source_type=DocumentType.API_SPEC,
                    source_id=f"{method} {path}",
                    title=str(op.get("summary") or op.get("operationId") or f"{method} {path}"),
                    text=_operation_text(method, str(path), op, security),
                    metadata={
                        "method": method,
                        "path": str(path),
                        "operationId": operation.operation_id,
                        "readOnly": operation.read_only,
                        "statusCodes": list(operation.status_codes),
                        "security": list(security),
                    },
                )
            )
    if not operations:
        raise DocumentParseError("paths에 HTTP 작업(get, post 등)이 없어요", "paths")
    return ParsedDocument(document_id, DocumentType.API_SPEC, chunks, operations=operations, raw_spec=spec)
