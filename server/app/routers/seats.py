from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import realtime
from app.constants import REDIS_KEYS, room_seat_map
from app.db import get_db
from app.deps import get_current_user
from app.errors import ApiError
from app.models import Seat, User
from app.redis_client import lock_script, redis_client, release_script
from app.services.queue_service import promote_queue_and_notify
from app.services.seat_lock_service import (
    acquire_seat_lock,
    get_lock_ttl,
    release_seat_lock,
)
from app.utils.ids import get_integer_id

router = APIRouter()


async def _load_seat(db: AsyncSession, event_id: int | None, seat_id: int | None) -> Seat:
    """Resolve the seat, or raise the single catch-all 404 used for any lookup failure here."""
    if event_id is None or seat_id is None:
        raise ApiError(404, "Seat, Event, or User is not Valid")
    seat = (await db.execute(select(Seat).where(Seat.id == seat_id))).scalar_one_or_none()
    if seat is None or seat.eventId != event_id:
        raise ApiError(404, "Seat, Event, or User is not Valid")
    return seat


# NOTE: no request body parameter. The frontend calls api.post(url) with a single
# argument, so axios sends no body and no Content-Type; declaring a body model
# here would 422 every lock attempt.
@router.post("/{eventId}/{seatId}/lock")
async def lock_seat(
    eventId: str,
    seatId: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    event_id = get_integer_id(eventId)
    seat_id = get_integer_id(seatId)
    seat = await _load_seat(db, event_id, seat_id)

    if seat.status == "BOOKED":
        raise ApiError(409, "Seat is already booked")

    # Non-reentrant by design (SET NX in Lua): even the current holder gets a
    # conflict on a second lock attempt.
    acquired = await acquire_seat_lock(lock_script, event_id, seat_id, user.id)
    if not acquired:
        raise ApiError(409, "Seat is currently locked by another user")

    ttl = await get_lock_ttl(redis_client, event_id, seat_id)

    await realtime.emit(
        "seat_status_changed",
        {"seatId": seat.id, "status": "LOCKED"},
        room=room_seat_map(event_id),
    )

    return {
        "message": "Seat locked successfully",
        # seatId is the raw path string here and an int on unlock -- an
        # inconsistency the frontend ignores, so left as-is.
        "seatId": seatId,
        "eventId": seat.eventId,
        "lockExpiresIn": ttl,
    }


@router.delete("/{eventId}/{seatId}/lock")
async def unlock_seat(
    eventId: str,
    seatId: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    event_id = get_integer_id(eventId)
    seat_id = get_integer_id(seatId)
    seat = await _load_seat(db, event_id, seat_id)

    released = await release_seat_lock(release_script, event_id, seat_id, user.id)
    if not released:
        raise ApiError(403, "You do not hold the lock on this seat")

    # Giving up the seat also gives up the active-pool slot, so the next person
    # in the waiting room can come in.
    await redis_client.srem(REDIS_KEYS.active_users(event_id), str(user.id))
    await promote_queue_and_notify(redis_client, event_id)

    await realtime.emit(
        "seat_status_changed",
        {"seatId": seat.id, "status": "AVAILABLE"},
        room=room_seat_map(event_id),
    )

    return {"message": "Seat Lock Released", "seatId": seat.id}
