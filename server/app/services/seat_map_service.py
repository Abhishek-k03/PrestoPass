"""Seat map serving + cache self-healing.

Served from the Redis hash rather than Postgres, because under a flash sale
this endpoint is polled by every waiting client.
"""

from __future__ import annotations

import logging
from typing import Any

from redis.asyncio.client import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import REDIS_KEYS
from app.models import Event, Seat
from app.utils.natsort import natural_key

log = logging.getLogger(__name__)


async def load_and_heal(db: AsyncSession, r: Redis, event: Event) -> list[dict[str, Any]]:
    """Return the seat map, reconciling the cache against the live lock keys.

    The cached status and the lock keys can drift: a lock expires by TTL without
    anyone rewriting the hash, or a lock is taken between two cache writes. Both
    directions are repaired here and written back.
    """
    hash_key = REDIS_KEYS.event_seats(event.id)
    seats_data: dict[str, str] = await r.hgetall(hash_key)

    # Lazy reload when the cache is empty or has drifted out of size with the event.
    if len(seats_data) == 0 or len(seats_data) != event.totalSeats:
        rows = (
            await db.execute(
                select(Seat.id, Seat.seatNumber, Seat.status)
                .where(Seat.eventId == event.id)
                .order_by(Seat.seatNumber.asc())
            )
        ).all()
        if rows:
            seats_data = {str(sid): f"{number}:{status}" for sid, number, status in rows}
            # One HSET rather than a pipeline of N -- same result, one round trip.
            await r.hset(hash_key, mapping=seats_data)

    # Values are "{seatNumber}:{STATUS}" -- split on the FIRST colon, since a
    # seat number could in principle contain one.
    seats: list[dict[str, Any]] = []
    for seat_id, value in seats_data.items():
        seat_number, _, status = value.partition(":")
        seats.append({"id": int(seat_id), "seatNumber": seat_number, "status": status})

    seats.sort(key=lambda s: natural_key(s["seatNumber"]))

    if not seats:
        return seats

    # One MGET for every lock key, rather than N round trips.
    lock_keys = [REDIS_KEYS.seat_lock(event.id, s["id"]) for s in seats]
    lock_holders = await r.mget(lock_keys)

    pipe = r.pipeline()
    needs_healing = False

    for seat, holder in zip(seats, lock_holders, strict=True):
        if seat["status"] == "LOCKED" and not holder:
            # The lock expired by TTL; nobody rewrote the cache.
            seat["status"] = "AVAILABLE"
            pipe.hset(hash_key, str(seat["id"]), f"{seat['seatNumber']}:AVAILABLE")
            needs_healing = True
        elif seat["status"] == "AVAILABLE" and holder:
            # A lock exists that the cache never recorded.
            seat["status"] = "LOCKED"
            pipe.hset(hash_key, str(seat["id"]), f"{seat['seatNumber']}:LOCKED")
            needs_healing = True

    if needs_healing:
        try:
            # Awaited rather than fire-and-forget: it is one round trip, and a
            # bare create_task without a strong reference can be garbage collected.
            await pipe.execute()
        except Exception:
            log.exception("Self-healing cache sync failed for event %s", event.id)

    return seats
