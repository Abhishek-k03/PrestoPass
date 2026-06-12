"""Redis seat locks.

All mutation happens inside the two Lua scripts in ``app/lua/`` -- they are the
anti-oversell guarantee, so every edge case (already locked, wrong holder,
already expired) has to be handled atomically inside the script itself.
"""

from __future__ import annotations

from redis.asyncio.client import Redis
from redis.commands.core import AsyncScript

from app.constants import LOCK_TTL_SECONDS, REDIS_KEYS


async def acquire_seat_lock(script: AsyncScript, event_id: int, seat_id: int, user_id: int) -> bool:
    """SET NX with a TTL, plus a seat-map cache update, atomically.

    Non-reentrant: re-locking a seat you already hold returns False -- see
    ``lockSeat.lua``.
    """
    result = await script(
        keys=[REDIS_KEYS.seat_lock(event_id, seat_id), REDIS_KEYS.event_seats(event_id)],
        # Every ARGV is a string: releaseLock.lua compares holder == userId in Lua,
        # which is a string comparison.
        args=[str(user_id), str(LOCK_TTL_SECONDS), str(seat_id)],
    )
    return result == 1


async def release_seat_lock(script: AsyncScript, event_id: int, seat_id: int, user_id: int) -> bool:
    """Release, but only if this user actually holds the lock."""
    result = await script(
        keys=[REDIS_KEYS.seat_lock(event_id, seat_id), REDIS_KEYS.event_seats(event_id)],
        args=[str(user_id), str(seat_id)],
    )
    return result == 1


async def get_lock_holder(r: Redis, event_id: int, seat_id: int) -> str | None:
    return await r.get(REDIS_KEYS.seat_lock(event_id, seat_id))


async def get_lock_ttl(r: Redis, event_id: int, seat_id: int) -> int:
    """Seconds remaining; -2 when the key is already gone."""
    return await r.ttl(REDIS_KEYS.seat_lock(event_id, seat_id))


async def set_cache_status(r: Redis, event_id: int, seat_id: int, status: str) -> None:
    """Rewrite one seat's status in the cache, preserving its seat number."""
    hash_key = REDIS_KEYS.event_seats(event_id)
    value = await r.hget(hash_key, str(seat_id))
    if not value:
        return
    seat_number, _, _ = value.partition(":")
    await r.hset(hash_key, str(seat_id), f"{seat_number}:{status}")
