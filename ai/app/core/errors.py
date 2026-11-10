"""계약의 오류 응답(application/problem+json)과 작업 실패 표현."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.codes import AiErrorCode, AiProblemCode

PROBLEM_JSON = "application/problem+json"


def problem(status: int, title: str, detail: str | None = None, code: AiProblemCode | None = None) -> JSONResponse:
    body: dict[str, Any] = {"title": title, "status": status}
    if detail:
        body["detail"] = detail
    if code:
        body["code"] = code
    return JSONResponse(body, status_code=status, media_type=PROBLEM_JSON)


class ApiProblem(Exception):
    """라우터에서 계약된 오류 응답을 내기 위한 예외."""

    def __init__(self, status: int, title: str, detail: str | None = None, code: AiProblemCode | None = None) -> None:
        super().__init__(detail or title)
        self.status = status
        self.title = title
        self.detail = detail
        self.code = code


class JobFailure(Exception):
    """작업을 FAILED로 끝내는 예외. result가 있으면 실패해도 함께 돌려준다."""

    def __init__(
        self,
        code: AiErrorCode,
        message: str,
        *,
        retryable: bool,
        result: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.result = result


def _format_validation_errors(exc: RequestValidationError) -> str:
    parts = []
    for err in exc.errors():
        loc = ".".join(str(p) for p in err.get("loc", ()) if p != "body")
        parts.append(f"{loc}: {err.get('msg', '')}")
    return "; ".join(parts)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        # 계약은 입력 오류를 400 problem+json으로 정한다 (FastAPI 기본값 422 대신).
        return problem(400, "입력값이 올바르지 않아요", _format_validation_errors(exc), AiProblemCode.INVALID_REQUEST)

    @app.exception_handler(ApiProblem)
    async def _api_problem(_: Request, exc: ApiProblem) -> JSONResponse:
        return problem(exc.status, exc.title, exc.detail, exc.code)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return problem(exc.status_code, str(exc.detail))
