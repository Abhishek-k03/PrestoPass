from __future__ import annotations

import json
import logging
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.deps import get_current_user
from app.errors import ApiError
from app.models import User
from app.schemas.auth import LoginIn, RegisterIn
from app.schemas.serializers import serialize_user
from app.services.auth_service import google_login, login_user, register_user

log = logging.getLogger(__name__)

router = APIRouter()

COOKIE_MAX_AGE = 7 * 24 * 60 * 60  # 7 days, matching the JWT lifetime


def _set_token_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        "token",
        token,
        httponly=True,
        secure=settings.is_production,
        samesite="strict",
        max_age=COOKIE_MAX_AGE,
    )


@router.post("/register", status_code=201)
async def register(payload: RegisterIn, db: AsyncSession = Depends(get_db)) -> Response:
    if not (payload.name and payload.email and payload.password):
        raise ApiError(400, "All fields are required")

    token, user = await register_user(db, payload.name, payload.email, payload.password)
    response = JSONResponse(
        content={"success": True, "token": token, "user": user}, status_code=201
    )
    _set_token_cookie(response, token)
    return response


@router.post("/login")
async def login(payload: LoginIn, db: AsyncSession = Depends(get_db)) -> Response:
    if not (payload.email and payload.password):
        raise ApiError(400, "Email and password are required")

    token, user = await login_user(db, payload.email, payload.password)
    response = JSONResponse(content={"success": True, "token": token, "user": user})
    _set_token_cookie(response, token)
    return response


@router.get("/me")
async def get_profile(user: User = Depends(get_current_user)) -> dict:
    return {"success": True, "user": serialize_user(user, include_created_at=True)}


@router.get("/google")
async def google_auth(request: Request):
    if not settings.google_enabled:
        raise ApiError(503, "Google Sign-In is not configured on this server")
    from app.oauth import oauth

    return await oauth.google.authorize_redirect(request, settings.GOOGLE_CALLBACK_URL)


@router.get("/google/callback")
async def google_callback(request: Request, db: AsyncSession = Depends(get_db)):
    if not settings.google_enabled:
        raise ApiError(503, "Google Sign-In is not configured on this server")
    from app.oauth import oauth

    try:
        token_data = await oauth.google.authorize_access_token(request)
    except Exception:
        log.exception("Google OAuth callback failed")
        raise ApiError(401, "Google authentication failed") from None

    info = token_data.get("userinfo") or {}
    google_id = info.get("sub")
    if not google_id:
        raise ApiError(401, "Google authentication failed")

    token, user = await google_login(
        db,
        google_id=google_id,
        email=info.get("email", ""),
        name=info.get("name", ""),
        avatar=info.get("picture"),
    )

    # separators=(",",":") matches JSON.stringify; quote(safe="") matches
    # encodeURIComponent closely enough for decodeURIComponent to reverse.
    encoded_user = quote(json.dumps(user, separators=(",", ":")), safe="")
    # Redirects to FRONTEND_URL -- port 4000, the frontend's actual dev port.
    return RedirectResponse(
        f"{settings.FRONTEND_URL.rstrip('/')}/auth/callback?token={token}&user={encoded_user}",
        status_code=302,
    )
