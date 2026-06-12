from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.constants import MAX_ACTIVE_USERS, QUEUE_TTL_SECONDS, REDIS_KEYS
from app.db import get_db
from app.deps import QueueIdentity, require_admin, resolve_queue_identity
from app.errors import ApiError
from app.models import Event
from app.redis_client import redis_client
from app.schemas.events import EventCreateIn, EventUpdateIn
from app.schemas.serializers import serialize_event
from app.services import event_service
from app.services.seat_map_service import load_and_heal
from app.utils.ids import get_integer_id
from app.utils.timefmt import to_naive_utc

log = logging.getLogger(__name__)

router = APIRouter()

GUEST_COOKIE_MAX_AGE = 24 * 60 * 60


def _event_id_or_400(raw: str) -> int:
    event_id = get_integer_id(raw)
    if event_id is None:
        raise ApiError(400, "Invalid event ID format")
    return event_id


def _maybe_set_guest_cookie(response: Response, identity: QueueIdentity) -> None:
    if not identity.is_new_guest:
        return
    response.set_cookie(
        "guest_session",
        identity.id,
        httponly=True,
        secure=settings.is_production,
        samesite="strict",
        max_age=GUEST_COOKIE_MAX_AGE,
    )


@router.get("")
@router.get("/", include_in_schema=False)
async def list_all_events(
    query: str | None = Query(None), db: AsyncSession = Depends(get_db)
) -> dict:
    try:
        return {"events": await event_service.search_events(db, query)}
    except Exception:
        log.exception("Failed to fetch events")
        raise ApiError(500, "Failed to fetch events") from None


@router.get("/{eventId}")
async def get_event(eventId: str, db: AsyncSession = Depends(get_db)) -> dict:
    event_id = _event_id_or_400(eventId)
    event = await event_service.get_event(db, event_id)
    if event is None:
        raise ApiError(404, "Event not found")
    available = await event_service.count_available_seats(db, event_id)
    return {"event": serialize_event(event, available_seats=available)}


@router.post("", status_code=201)
@router.post("/", status_code=201, include_in_schema=False)
async def create_an_event(
    payload: EventCreateIn,
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_admin),
) -> dict:
    try:
        event = Event(
            name=payload.name,
            venue=payload.venue,
            date=to_naive_utc(payload.date),
            totalSeats=payload.totalSeats,
            price=payload.price,
            imageUrl=payload.imageUrl or "",
        )
        db.add(event)
        await db.flush()
        await event_service.create_seats(db, event.id, payload.totalSeats)
        await db.commit()
        await db.refresh(event)

        await event_service.populate_seat_cache(db, redis_client, event.id)
        seat_count = await event_service.count_seats(db, event.id)
        return {"event": serialize_event(event, seat_count=seat_count)}
    except ApiError:
        raise
    except Exception as exc:
        await db.rollback()
        log.exception("Failed to create event")
        raise ApiError(500, str(exc) or "Failed to create event") from None


@router.put("/{eventId}")
async def update_an_event(
    eventId: str,
    payload: EventUpdateIn,
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_admin),
) -> dict:
    event_id = _event_id_or_400(eventId)
    fields = payload.model_dump(exclude_unset=True)

    try:
        event = await event_service.get_event(db, event_id)
        if event is None:
            raise ApiError(404, "Event not found or failed to update")

        # Deliberately asymmetric: these apply only when truthy, but totalSeats
        # applies whenever present (so 0 is honoured).
        if fields.get("name"):
            event.name = fields["name"]
        if fields.get("venue"):
            event.venue = fields["venue"]
        if fields.get("imageUrl"):
            event.imageUrl = fields["imageUrl"]
        if fields.get("date"):
            event.date = to_naive_utc(fields["date"])

        # Present-not-truthy, like totalSeats below: setting a price back to 0
        # ("unpublish this event") has to be expressible.
        if fields.get("price") is not None:
            event.price = fields["price"]

        resized = fields.get("totalSeats") is not None
        if resized:
            total = fields["totalSeats"]
            event.totalSeats = total
            # Seats are dropped and recreated, so a seat that already has a
            # booking trips the FK RESTRICT and the transaction rolls back.
            await event_service.delete_seats(db, event_id)
            await db.flush()
            await event_service.create_seats(db, event_id, total)

        await db.commit()
        await db.refresh(event)

        if resized:
            await redis_client.delete(REDIS_KEYS.event_seats(event_id))
            await event_service.populate_seat_cache(db, redis_client, event_id)

        return {"event": serialize_event(event)}
    except ApiError:
        raise
    except Exception:
        await db.rollback()
        log.exception("Failed to update event %s", event_id)
        raise ApiError(404, "Event not found or failed to update") from None


@router.delete("/{eventId}")
async def delete_an_event(
    eventId: str,
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_admin),
) -> dict:
    event_id = _event_id_or_400(eventId)
    try:
        event = await event_service.get_event(db, event_id)
        if event is None:
            raise ApiError(404, "Event not found")
        payload = serialize_event(event)

        await event_service.delete_seats(db, event_id)
        await db.delete(event)
        await db.commit()

        await redis_client.delete(REDIS_KEYS.event_seats(event_id))
        return {
            "message": "Event and associated seats deleted successfully",
            "event": payload,
        }
    except ApiError:
        raise
    except Exception:
        await db.rollback()
        log.exception("Failed to delete event %s", event_id)
        raise ApiError(404, "Event not found") from None


@router.get("/{eventId}/seats")
async def get_seat_map(
    eventId: str,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Waiting room + seat map. Auth is optional; guests queue by session id."""
    event_id = _event_id_or_400(eventId)
    event = await event_service.get_event(db, event_id)
    if event is None:
        raise ApiError(404, "Event not found")

    identity = resolve_queue_identity(request)
    queue_key = REDIS_KEYS.waiting_queue(event_id)
    active_key = REDIS_KEYS.active_users(event_id)

    is_active = await redis_client.sismember(active_key, identity.id)

    if not is_active:
        # NX so joining stays idempotent across refreshes and 5s polls.
        await redis_client.zadd(queue_key, {identity.id: int(time.time() * 1000)}, nx=True)
        if await redis_client.ttl(queue_key) == -1:
            await redis_client.expire(queue_key, QUEUE_TTL_SECONDS)

        active_count = await redis_client.scard(active_key)
        if active_count < MAX_ACTIVE_USERS:
            vacancies = MAX_ACTIVE_USERS - active_count
            next_users = await redis_client.zrange(queue_key, 0, vacancies - 1)
            if next_users:
                await redis_client.sadd(active_key, *next_users)
                await redis_client.zrem(queue_key, *next_users)

        is_active = await redis_client.sismember(active_key, identity.id)

        if not is_active:
            _maybe_set_guest_cookie(response, identity)
            rank = await redis_client.zrank(queue_key, identity.id)
            # 202, not 429: being queued is a successful answer, and the
            # frontend polls on a 2xx.
            response.status_code = 202
            return {
                "status": "WAITING",
                "queuePosition": (rank + 1) if rank is not None else 1,
                "message": "You are in the waiting queue.",
            }

    _maybe_set_guest_cookie(response, identity)
    seats = await load_and_heal(db, redis_client, event)
    return {"status": "ACTIVE", "seats": seats}
