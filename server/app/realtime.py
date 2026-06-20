"""Process-agnostic Socket.IO emit.

The API and the payment worker run as separate processes, so a worker task
cannot reach the API's in-memory Socket.IO server directly. Both processes
bind an emitter to this module instead, and every call site stays identical:

* API      -> the ``AsyncServer`` itself (delivers locally *and* publishes to Redis)
* worker   -> ``AsyncRedisManager(..., write_only=True)`` (publishes only)

The API's server-side manager subscribes to the same Redis channel and fans the
worker's messages out to the connected browsers.
"""

from __future__ import annotations

import logging
from typing import Any

import socketio

log = logging.getLogger(__name__)

_emitter: Any | None = None


def set_emitter(emitter: Any | None) -> None:
    global _emitter
    _emitter = emitter


def get_emitter() -> Any | None:
    return _emitter


async def emit(event: str, data: dict[str, Any], room: str, namespace: str = "/") -> None:
    """Emit to a room. Never raises -- a dead socket layer must not fail a booking.

    Payloads must stay plain JSON-ish dicts: the cross-process transport pickles
    them, so no ORM objects and no datetimes.
    """
    if _emitter is None:
        log.warning("realtime.emit(%s -> %s) dropped: no emitter bound", event, room)
        return
    try:
        if isinstance(_emitter, socketio.AsyncServer):
            # AsyncServer prefers `to=`; `room=` is a legacy alias.
            await _emitter.emit(event, data, to=room, namespace=namespace)
        else:
            # AsyncPubSubManager.emit takes `room=`.
            await _emitter.emit(event, data, room=room, namespace=namespace)
    except Exception:
        log.exception("realtime.emit failed (%s -> %s)", event, room)
