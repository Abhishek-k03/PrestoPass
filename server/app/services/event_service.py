"""Event search, seat creation/counts, and seat-cache population."""

from __future__ import annotations

from typing import Any

from redis.asyncio.client import Redis
from sqlalchemy import delete, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import REDIS_KEYS
from app.models import Event, Seat
from app.schemas.serializers import serialize_event

_LIKE_ESCAPE = "\\"


def _escape_like(term: str) -> str:
    """Escape LIKE metacharacters so a search for '%' matches a literal '%'."""
    out = term.replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2)
    out = out.replace("%", _LIKE_ESCAPE + "%")
    return out.replace("_", _LIKE_ESCAPE + "_")


async def search_events(db: AsyncSession, query: str | None) -> list[dict[str, Any]]:
    """List events with seat counts.

    A single grouped aggregate avoids one COUNT query per event -- same output,
    one round trip.

    Note ``if query`` and not ``if query is not None``: the events page always
    appends ``?query=``, so an empty string must mean "no filter".
    """
    total_seats = func.count(Seat.id)
    available_seats = func.count(Seat.id).filter(Seat.status == "AVAILABLE")

    stmt = (
        select(
            Event,
            func.coalesce(total_seats, 0).label("seat_count"),
            func.coalesce(available_seats, 0).label("available_seats"),
        )
        .outerjoin(Seat, Seat.eventId == Event.id)
        .group_by(Event.id)
        .order_by(Event.date.asc(), Event.id.asc())
    )

    if query:
        pattern = f"%{_escape_like(query)}%"
        stmt = stmt.where(
            Event.name.ilike(pattern, escape="\\") | Event.venue.ilike(pattern, escape="\\")
        )

    rows = (await db.execute(stmt)).all()
    return [
        serialize_event(event, available_seats=available, seat_count=count)
        for event, count, available in rows
    ]


async def count_available_seats(db: AsyncSession, event_id: int) -> int:
    return (
        await db.execute(
            select(func.count(Seat.id)).where(Seat.eventId == event_id, Seat.status == "AVAILABLE")
        )
    ).scalar_one()


async def count_seats(db: AsyncSession, event_id: int) -> int:
    return (
        await db.execute(select(func.count(Seat.id)).where(Seat.eventId == event_id))
    ).scalar_one()


async def create_seats(db: AsyncSession, event_id: int, total_seats: int) -> None:
    """Create seats named A1..A{n}."""
    if total_seats <= 0:
        return
    await db.execute(
        insert(Seat),
        [{"eventId": event_id, "seatNumber": f"A{i + 1}"} for i in range(total_seats)],
    )


async def delete_seats(db: AsyncSession, event_id: int) -> None:
    await db.execute(delete(Seat).where(Seat.eventId == event_id))


async def populate_seat_cache(db: AsyncSession, r: Redis, event_id: int) -> None:
    """Rebuild ``event_seats:{id}`` from the database.

    Hash value format is ``"{seatNumber}:{STATUS}"`` -- shared byte-for-byte with
    the Lua scripts, which read and rewrite this exact format.
    """
    rows = (
        await db.execute(
            select(Seat.id, Seat.seatNumber, Seat.status).where(Seat.eventId == event_id)
        )
    ).all()
    if not rows:
        return
    mapping = {str(sid): f"{number}:{status}" for sid, number, status in rows}
    await r.hset(REDIS_KEYS.event_seats(event_id), mapping=mapping)


async def get_event(db: AsyncSession, event_id: int) -> Event | None:
    return (await db.execute(select(Event).where(Event.id == event_id))).scalar_one_or_none()
