from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt
from starlette.concurrency import run_in_threadpool

from app.config import settings

_BCRYPT_ROUNDS = 10


def _prep(password: str) -> bytes:
    """Encode and truncate to bcrypt's 72-byte limit.

    The ``bcrypt`` package (5.0+) raises on longer input rather than truncating
    silently, so truncate explicitly here.
    """
    return password.encode("utf-8")[:72]


async def hash_password(password: str) -> str:
    # bcrypt cost 10 is ~60-80ms of pure CPU; inline it and every login stalls
    # the whole event loop.
    digest = await run_in_threadpool(
        bcrypt.hashpw, _prep(password), bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)
    )
    return digest.decode("utf-8")


async def verify_password(password: str, hashed: str) -> bool:
    try:
        return await run_in_threadpool(bcrypt.checkpw, _prep(password), hashed.encode("utf-8"))
    except ValueError:
        # Malformed/legacy hash in the database.
        return False


def generate_token(user_id: int, email: str) -> str:
    """HS256, 7 days.

    The claim MUST be named ``userId`` -- the Socket.IO layer routes rooms off
    ``decoded.userId`` and the frontend's stored tokens use it.
    """
    now = datetime.now(UTC)
    payload = {
        "userId": user_id,
        "email": email,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=settings.JWT_EXPIRES_DAYS)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def verify_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
