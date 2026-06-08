"""Error responses.

The frontend reads a different key depending on the page: `.error` on
login/register/admin, `.message` on the booking flow. FastAPI's default
``{"detail": ...}`` body is read by neither, so every error here carries
``success``, ``error``, and ``message``, with the same string in the last two --
whichever key a given page reads, it gets the message.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger(__name__)


class ApiError(StarletteHTTPException):
    """The only way a route should signal failure."""

    def __init__(self, status_code: int, message: str, extra: dict[str, Any] | None = None):
        super().__init__(status_code=status_code, detail=message)
        self.extra = extra or {}


def error_body(message: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"success": False, "error": message, "message": message, **(extra or {})}


async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(content=error_body(str(exc.detail), exc.extra), status_code=exc.status_code)


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
    return JSONResponse(
        content=error_body(detail),
        status_code=exc.status_code,
        headers=getattr(exc, "headers", None),
    )


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    errors = exc.errors()
    first = errors[0] if errors else {}
    loc = ".".join(str(p) for p in first.get("loc", ())[1:]) or "request"
    message = f"{loc}: {first.get('msg', 'Invalid request body')}"
    # 400, not FastAPI's default 422, to match every other validation error here.
    return JSONResponse(
        content=error_body(message, {"details": jsonable_encoder(errors)}),
        status_code=400,
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(content=error_body("Internal Server Error"), status_code=500)
