"""Virtual waiting room: promotes queued users into the active pool.

Takes the Redis client as a parameter so the exact same function runs unchanged
in the API process and in the payment worker.
"""

from __future__ import annotations

import logging

from redis.asyncio.client import Redis

from app import realtime
from app.constants import (
    MAX_ACTIVE_USERS,
    REDIS_KEYS,
    room_event_queue,
    room_user,
)

log = logging.getLogger(__name__)


async def promote_queue_and_notify(r: Redis, event_id: int) -> None:
    """Fill any vacancies in the active pool from the head of the queue, then
    push everyone still waiting their updated position."""
    queue_key = REDIS_KEYS.waiting_queue(event_id)
    active_key = REDIS_KEYS.active_users(event_id)

    active_count = await r.scard(active_key)
    vacancies = MAX_ACTIVE_USERS - active_count

    if vacancies > 0:
        next_users = await r.zrange(queue_key, 0, vacancies - 1)
        if next_users:
            await r.sadd(active_key, *next_users)
            await r.zrem(queue_key, *next_users)
            for uid in next_users:
                await realtime.emit(
                    "queue_promoted",
                    {
                        "status": "ACTIVE",
                        "message": (
                            "You have been promoted to active. "
                            "You can now view the seat map and book."
                        ),
                    },
                    room=room_user(uid),
                )

    remaining = await r.zrange(queue_key, 0, -1)
    for index, uid in enumerate(remaining):
        position = index + 1
        await realtime.emit(
            "queue_update",
            {
                "status": "WAITING",
                "queuePosition": position,
                "message": f"Your updated queue position is {position}.",
            },
            room=room_user(uid),
        )

    await realtime.emit(
        "queue_moved",
        {"remainingCount": len(remaining), "activeCount": await r.scard(active_key)},
        room=room_event_queue(event_id),
    )
