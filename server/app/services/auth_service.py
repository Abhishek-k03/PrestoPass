"""Registration, login, and Google OAuth account linking."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError
from app.models import User
from app.schemas.serializers import serialize_user
from app.security import generate_token, hash_password, verify_password


async def register_user(
    db: AsyncSession, name: str, email: str, password: str
) -> tuple[str, dict[str, Any]]:
    existing = (await db.execute(select(User.id).where(User.email == email))).scalar_one_or_none()
    if existing is not None:
        raise ApiError(400, "User already exists")

    user = User(
        name=name,
        email=email,
        passwordHash=await hash_password(password),
        role="CUSTOMER",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return generate_token(user.id, user.email), serialize_user(user)


async def login_user(db: AsyncSession, email: str, password: str) -> tuple[str, dict[str, Any]]:
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        raise ApiError(401, "Invalid email or password")
    if not user.passwordHash:
        raise ApiError(401, "This account uses Google Sign-In")
    if not await verify_password(password, user.passwordHash):
        raise ApiError(401, "Invalid email or password")

    return generate_token(user.id, user.email), serialize_user(user)


async def google_login(
    db: AsyncSession,
    google_id: str,
    email: str,
    name: str,
    avatar: str | None = None,
) -> tuple[str, dict[str, Any]]:
    """Find-or-link-or-create a Google user.

    `role` is included in all three branches on purpose: the frontend persists
    this object to localStorage and its admin guard reads `user.role`, so an
    admin created or linked here must not come back without one.
    """
    user = (await db.execute(select(User).where(User.googleId == google_id))).scalar_one_or_none()

    if user is None:
        by_email = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if by_email is not None:
            by_email.googleId = google_id
            if avatar:
                by_email.avatar = avatar
            user = by_email
        else:
            user = User(
                name=name,
                email=email,
                googleId=google_id,
                avatar=avatar,
                role="CUSTOMER",
            )
            db.add(user)
        await db.commit()
        await db.refresh(user)

    return generate_token(user.id, user.email), serialize_user(user)
