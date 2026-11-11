"""대상 사이트 OpenAPI 명세에서 응답 스키마를 꺼내 JSON Schema로 바꾼다 (ADR-014).

LLM이 쓰지 않고 코드가 명세에서 복사한다. 실행기는 명세 파일에 접근하지 않으므로 $ref를 모두 풀어 넣는다.
OpenAPI 3.0의 nullable은 JSON Schema의 type 배열로 바꾼다 (실행기 Ajv가 읽을 수 있게).
"""

from __future__ import annotations

import copy
from typing import Any
from urllib.parse import urlparse

MAX_DEPTH = 12
_DROP_KEYS = {"example", "examples", "xml", "externalDocs", "discriminator", "readOnly", "writeOnly", "deprecated"}


def server_base_path(spec: dict[str, Any]) -> str:
    """servers[0].url의 경로 부분 (예: https://shop.example.test/api → /api). 없으면 빈 문자열."""
    servers = spec.get("servers")
    if isinstance(servers, list) and servers and isinstance(servers[0], dict):
        path = urlparse(str(servers[0].get("url", ""))).path.rstrip("/")
        return path if path.startswith("/") else ""
    return ""


def _resolve_ref(spec: dict[str, Any], ref: str) -> Any:
    if not ref.startswith("#/"):
        return None
    node: Any = spec
    for part in ref[2:].split("/"):
        part = part.replace("~1", "/").replace("~0", "~")
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def to_json_schema(spec: dict[str, Any], schema: Any, depth: int = 0, seen: tuple[str, ...] = ()) -> Any:
    if depth > MAX_DEPTH:
        return {}
    if isinstance(schema, list):
        return [to_json_schema(spec, s, depth + 1, seen) for s in schema]
    if not isinstance(schema, dict):
        return schema
    if "$ref" in schema:
        ref = str(schema["$ref"])
        if ref in seen:  # 순환 참조는 더 풀지 않는다
            return {}
        target = _resolve_ref(spec, ref)
        return to_json_schema(spec, target, depth + 1, (*seen, ref)) if target is not None else {}
    out: dict[str, Any] = {}
    for key, value in schema.items():
        if key in _DROP_KEYS or key.startswith("x-"):
            continue
        if key in {"properties", "patternProperties", "$defs", "definitions"} and isinstance(value, dict):
            out[key] = {k: to_json_schema(spec, v, depth + 1, seen) for k, v in value.items()}
        elif key in {"items", "additionalProperties", "not", "allOf", "anyOf", "oneOf"}:
            out[key] = to_json_schema(spec, value, depth + 1, seen)
        elif key == "nullable":
            continue
        else:
            out[key] = copy.deepcopy(value)
    if schema.get("nullable") is True:
        t = out.get("type")
        if isinstance(t, str):
            out["type"] = [t, "null"]
        elif isinstance(t, list) and "null" not in t:
            out["type"] = [*t, "null"]
    return out


def response_schema(spec: dict[str, Any], method: str, path: str, status: int) -> dict[str, Any] | None:
    """명세 path(서버 경로 제외)·method·상태 코드의 JSON 응답 스키마. 없으면 None (실행기는 NOT_CHECKED)."""
    op = (spec.get("paths") or {}).get(path, {}).get(method.lower())
    if not isinstance(op, dict):
        return None
    responses = op.get("responses") or {}
    resp = responses.get(str(status))
    if resp is None:
        resp = responses.get(f"{str(status)[0]}XX") or responses.get(f"{str(status)[0]}xx")
    if isinstance(resp, dict) and "$ref" in resp:
        resp = _resolve_ref(spec, str(resp["$ref"]))
    if not isinstance(resp, dict):
        return None
    content = resp.get("content") or {}
    media = next((v for k, v in content.items() if k.split(";")[0].strip().endswith("json")), None)
    if not isinstance(media, dict) or "schema" not in media:
        return None
    result = to_json_schema(spec, media["schema"])
    return result if isinstance(result, dict) and result else None


_CONSTRAINTS = ("type", "minimum", "maximum", "minLength", "maxLength", "pattern", "enum")


def request_fields(spec: dict[str, Any], method: str, path: str) -> dict[str, dict[str, Any]]:
    """요청 본문 최상위 필드 이름 → 타입과 제약(최솟값·최댓값·길이·패턴).

    LLM 문맥과 가짜 응답기가 본문을 만들 때 쓴다.
    """
    op = (spec.get("paths") or {}).get(path, {}).get(method.lower())
    if not isinstance(op, dict):
        return {}
    body = op.get("requestBody") or {}
    content = body.get("content") or {} if isinstance(body, dict) else {}
    media = next((v for k, v in content.items() if k.endswith("json")), None)
    schema = to_json_schema(spec, media.get("schema")) if isinstance(media, dict) else None
    props = schema.get("properties") if isinstance(schema, dict) else None
    if not isinstance(props, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for name, prop in props.items():
        prop = prop if isinstance(prop, dict) else {}
        info = {k: prop[k] for k in _CONSTRAINTS if k in prop}
        info.setdefault("type", "string")
        out[name] = info
    return out
