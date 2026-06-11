"""Auth dependencies: current-user resolution, admin gating, and queue identity."""

from __future__ import annotations

import random
import string
import time
from dataclasses import dataclass

import jwt
from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.errors import ApiError
from app.models import User
from app.security import verify_token


def extract_token(request: Request) -> str | None:
    """Cookie first, then ``Authorization: Bearer``."""
    token = request.cookies.get("token")
    if token:
        return token
    auth = request.headers.get("authorization")
    if auth and auth.startswith("Bearer"):
        parts = auth.split(" ")
        return parts[1] if len(parts) > 1 else None
    return None


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    token = extract_token(request)
    if not token:
        raise ApiError(401, "Token missing")
    try:
        payload = verify_token(token)
        user_id = payload["userId"]
    except (jwt.PyJWTError, KeyError):
        raise ApiError(401, "Invalid or expired token") from None

    # Every authenticated request re-reads the row -- a deleted user's
    # still-valid token must stop working.
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise ApiError(401, "User not found")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "ADMIN":
        # 401, not 403 -- the frontend's admin route guard checks for this
        # status and message specifically.
        raise ApiError(401, "Unauthorized for Admin")
    return user


@dataclass(slots=True)
class QueueIdentity:
    """Who is queueing: a real user id, or a guest session id."""

    id: str
    is_new_guest: bool


def _mint_guest_id() -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=7))
    return f"guest_{int(time.time() * 1000)}_{suffix}"


def resolve_queue_identity(request: Request) -> QueueIdentity:
    """Optional auth for the seat map.

    A valid token wins; otherwise fall back to a guest session id from the
    header, then the cookie, then mint a fresh one. An invalid token is silently
    treated as a guest.
    """
    token = extract_token(request)
    if token:
        try:
            return QueueIdentity(str(verify_token(token)["userId"]), False)
        except (jwt.PyJWTError, KeyError):
            pass  # fall through to guest

    guest_id = request.headers.get("x-guest-session-id") or request.cookies.get("guest_session")
    if guest_id:
        return QueueIdentity(guest_id, False)
    return QueueIdentity(_mint_guest_id(), True)
