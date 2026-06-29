from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.redis_client import redis_client

router = APIRouter()


@router.get("/health")
async def health() -> JSONResponse:
    # Its own response shape, not error_body() elsewhere -- this endpoint is for
    # infrastructure health checks, not the frontend.
    try:
        await redis_client.ping()
        return JSONResponse(content={"status": "ok", "redis": "connected"})
    except Exception as exc:
        return JSONResponse(content={"status": "error", "error": str(exc)}, status_code=500)
