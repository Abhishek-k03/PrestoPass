"""Socket.IO server.

Room names, event names, and handshake auth are a fixed contract:
``frontend/src/app/events/[id]/page.tsx`` depends on them exactly.
"""

from __future__ import annotations

import logging
from urllib.parse import parse_qs

import jwt
import socketio

from app.config import settings
from app.constants import REDIS_KEYS, room_event_queue, room_seat_map, room_user
from app.redis_client import redis_client
from app.security import verify_token
from app.services.queue_service import promote_queue_and_notify

log = logging.getLogger(__name__)

# The Redis client manager is what lets the separate payment-worker process
# reach these browsers (see app/realtime.py).
client_manager = socketio.AsyncRedisManager(
    settings.REDIS_URL, channel=settings.SOCKETIO_CHANNEL, write_only=False
)

sio = socketio.AsyncServer(
    async_mode="asgi",
    client_manager=client_manager,
    # An explicit list, not "*": the client connects with withCredentials=true.
    cors_allowed_origins=settings.cors_origins,
    cors_credentials=True,
    logger=False,
    engineio_logger=False,
)


@sio.event
async def connect(sid: str, environ: dict, auth: dict | None = None) -> None:
    token = (auth or {}).get("token")
    if not token:
        token = parse_qs(environ.get("QUERY_STRING", "")).get("token", [None])[0]

    if not token:
        raise socketio.exceptions.ConnectionRefusedError("Authentication error: Token missing")
    try:
        user_id = verify_token(token)["userId"]
    except (jwt.PyJWTError, KeyError):
        raise socketio.exceptions.ConnectionRefusedError(
            "Authentication error: Invalid token"
        ) from None

    await sio.save_session(sid, {"userId": user_id})
    await sio.enter_room(sid, room_user(user_id))
    log.info("socket connected: sid=%s userId=%s", sid, user_id)


@sio.on("join_event_queue")
async def join_event_queue(sid: str, event_id) -> None:
    session = await sio.get_session(sid)
    session["eventId"] = event_id
    await sio.save_session(sid, session)
    await sio.enter_room(sid, room_event_queue(int(event_id)))


@sio.on("join_seat_map")
async def join_seat_map(sid: str, event_id) -> None:
    await sio.enter_room(sid, room_seat_map(int(event_id)))


@sio.on("leave_event_queue")
async def leave_event_queue(sid: str, event_id) -> None:
    try:
        session = await sio.get_session(sid)
    except KeyError:
        return
    user_id = session.get("userId")
    if user_id is None:
        return
    eid = int(event_id)
    await redis_client.zrem(REDIS_KEYS.waiting_queue(eid), str(user_id))
    await redis_client.srem(REDIS_KEYS.active_users(eid), str(user_id))
    await sio.leave_room(sid, room_event_queue(eid))
    await promote_queue_and_notify(redis_client, eid)


@sio.event
async def disconnect(sid: str) -> None:
    """Free the user's queue/active slot so the next waiter is promoted."""
    try:
        session = await sio.get_session(sid)
    except KeyError:
        return
    event_id = session.get("eventId")
    user_id = session.get("userId")
    if event_id is None or user_id is None:
        return
    try:
        eid = int(event_id)
        await redis_client.zrem(REDIS_KEYS.waiting_queue(eid), str(user_id))
        await redis_client.srem(REDIS_KEYS.active_users(eid), str(user_id))
        await promote_queue_and_notify(redis_client, eid)
    except Exception:
        log.exception("socket disconnect cleanup failed for sid=%s", sid)
