"""Datetime helpers.

The database columns are ``TIMESTAMP(3)`` *without* time zone, so everything
crossing the DB boundary must be naive UTC.
The JSON contract is the opposite: the frontend does ``new Date(event.date)``,
and per ES2015+ a date-time string with no offset is parsed as *local* time --
so an offset-less body silently shifts every rendered date by the viewer's UTC
offset. ``iso_z`` therefore reproduces JS ``Date.prototype.toJSON`` exactly.
"""

from __future__ import annotations

from datetime import UTC, datetime


def utcnow_naive() -> datetime:
    """Current UTC time as a naive datetime, for TIMESTAMP WITHOUT TIME ZONE."""
    return datetime.now(UTC).replace(tzinfo=None)


def to_naive_utc(dt: datetime) -> datetime:
    """Normalise an inbound datetime to naive UTC.

    Pydantic parses ``"2026-06-11T14:30:00.000Z"`` into an *aware* datetime, and
    asyncpg refuses aware datetimes for TIMESTAMP WITHOUT TIME ZONE columns.
    """
    if dt.tzinfo is not None:
        dt = dt.astimezone(UTC).replace(tzinfo=None)
    return dt


def iso_z(dt: datetime | None) -> str | None:
    """Serialise byte-identically to JS ``Date.prototype.toJSON()``.

    e.g. ``2026-06-11T14:30:00.000Z`` -- always exactly 3 fractional digits and
    a literal ``Z``.
    """
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(UTC).replace(tzinfo=None)
    return f"{dt:%Y-%m-%dT%H:%M:%S}.{dt.microsecond // 1000:03d}Z"
