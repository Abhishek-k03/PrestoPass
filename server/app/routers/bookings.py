from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import get_current_user
from app.errors import ApiError
from app.models import User
from app.redis_client import redis_client
from app.services import booking_service
from app.utils.ids import get_integer_id

log = logging.getLogger(__name__)

router = APIRouter()


# Declared BEFORE /{id} so the literal path wins -- otherwise "my" is captured
# as an id and every request 404s.
@router.get("/my")
async def get_my_bookings(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    try:
        bookings = await booking_service.get_my_bookings(db, redis_client, user.id)
        return {"success": True, "bookings": bookings}
    except Exception:
        log.exception("Failed to list bookings for user %s", user.id)
        raise ApiError(500, "Something went wrong") from None


@router.get("/{id}")
async def get_booking_by_id(
    id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    booking_id = get_integer_id(id)
    if booking_id is None:
        raise ApiError(404, "Booking not found")
    booking = await booking_service.get_booking_by_id(db, redis_client, booking_id, user.id)
    return {"success": True, "booking": booking}


@router.delete("/{id}")
async def cancel_booking(
    id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    booking_id = get_integer_id(id)
    if booking_id is None:
        raise ApiError(400, "Booking not found")
    booking = await booking_service.cancel_booking(db, redis_client, booking_id, user.id)
    return {
        "success": True,
        "message": "Booking cancelled successfully",
        "booking": booking,
    }
