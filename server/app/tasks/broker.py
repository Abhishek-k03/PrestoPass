"""taskiq broker + worker lifecycle for the payment queue.

Everything the worker needs -- engine, sessionmaker, Redis client, Lua scripts,
socket emitter -- is built inside WORKER_STARTUP rather than at import time.
asyncpg connections and Redis clients bind to the event loop that created them,
and taskiq's process manager imports this module before its loop exists.
"""

from __future__ import annotations

import contextlib
import logging

import socketio
from redis.asyncio import from_url as redis_from_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from taskiq import TaskiqEvents, TaskiqState
from taskiq_redis import ListQueueBroker, RedisAsyncResultBackend

from app import realtime
from app.config import settings
from app.redis_client import make_scripts

log = logging.getLogger(__name__)

broker = ListQueueBroker(
    settings.REDIS_URL,
    queue_name="paymentQueue",
    # socket_timeout=None is required, not cosmetic. ListQueueBroker.listen()
    # issues an indefinitely blocking BRPOP, but redis-py 8's maintenance-
    # notifications feature applies a default 5s socket read timeout. The BRPOP
    # then raises TimeoutError every 5 idle seconds, and listen() only catches
    # ConnectionError -- so the worker dies and the process manager restarts it
    # in a loop. Disabling the read timeout lets the blocking pop block.
    socket_timeout=None,
).with_result_backend(RedisAsyncResultBackend(settings.REDIS_URL, result_ex_time=600))


@broker.on_event(TaskiqEvents.WORKER_STARTUP)
async def worker_startup(state: TaskiqState) -> None:
    state.engine = create_async_engine(
        settings.DATABASE_URL,
        pool_size=settings.WORKER_DB_POOL_SIZE,
        max_overflow=settings.WORKER_DB_MAX_OVERFLOW,
        pool_pre_ping=True,
    )
    state.sessionmaker = async_sessionmaker(state.engine, expire_on_commit=False, autoflush=False)
    state.redis = redis_from_url(settings.REDIS_URL, decode_responses=True)
    state.lock_script, state.release_script = make_scripts(state.redis)

    # write_only: this process publishes to the Redis channel but never
    # subscribes. Do NOT call initialize() on it -- that path needs a server.
    state.sio_manager = socketio.AsyncRedisManager(
        settings.REDIS_URL, channel=settings.SOCKETIO_CHANNEL, write_only=True
    )
    realtime.set_emitter(state.sio_manager)
    log.info("payment worker ready (socket channel=%s)", settings.SOCKETIO_CHANNEL)


@broker.on_event(TaskiqEvents.WORKER_SHUTDOWN)
async def worker_shutdown(state: TaskiqState) -> None:
    realtime.set_emitter(None)

    manager = getattr(state, "sio_manager", None)
    if manager is not None:
        # AsyncRedisManager exposes no public close(); shut its clients directly.
        for attr in ("pubsub", "redis"):
            obj = getattr(manager, attr, None)
            if obj is not None:
                # Best effort: we are shutting down either way.
                with contextlib.suppress(Exception):
                    await obj.aclose()

    redis = getattr(state, "redis", None)
    if redis is not None:
        await redis.aclose()
    engine = getattr(state, "engine", None)
    if engine is not None:
        await engine.dispose()
