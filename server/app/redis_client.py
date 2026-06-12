from __future__ import annotations

import logging
from importlib.resources import files

import redis.asyncio as aioredis
from redis.asyncio.client import Redis
from redis.commands.core import AsyncScript

from app.config import settings

log = logging.getLogger(__name__)

# decode_responses=True makes GET/HGETALL/ZRANGE return str, matching ioredis.
redis_client: Redis = aioredis.from_url(
    settings.REDIS_URL, decode_responses=True, health_check_interval=30
)

_LUA_DIR = files("app.lua")
LOCK_SEAT_LUA = _LUA_DIR.joinpath("lockSeat.lua").read_text(encoding="utf-8")
RELEASE_LOCK_LUA = _LUA_DIR.joinpath("releaseLock.lua").read_text(encoding="utf-8")


def make_scripts(client: Redis) -> tuple[AsyncScript, AsyncScript]:
    """Register the Lua scripts against a client.

    A Script is bound to the client it was registered on (for the EVALSHA ->
    NOSCRIPT -> EVAL fallback), so the API and the worker each build their own.
    """
    return (
        client.register_script(LOCK_SEAT_LUA),
        client.register_script(RELEASE_LOCK_LUA),
    )


lock_script, release_script = make_scripts(redis_client)


async def clear_existing_queues(client: Redis) -> None:
    """Drop stale waiting-room state on API boot (port of redis.ts clearExistingQueues).

    API-lifespan only. Running this from the payment worker would wipe live
    queues out from under connected users on every worker restart.
    """
    deleted = 0
    for pattern in ("waiting_queue:*", "active_users:*"):
        batch: list[str] = []
        async for key in client.scan_iter(match=pattern, count=100):
            batch.append(key)
            if len(batch) >= 100:
                deleted += await client.delete(*batch)
                batch = []
        if batch:
            deleted += await client.delete(*batch)
    if deleted:
        log.info("Cleared %d stale queue key(s) on startup", deleted)
