"""Booking listing, lookup, and cancellation.

A checkout can be opened and then abandoned: the user walks away before
paying, and the booking would otherwise sit PENDING forever. See
:func:`reap_abandoned_bookings`.
"""

from __future__ import annotations

import logging
from typing import Any

from redis.asyncio.client import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.errors import ApiError
from app.models import Booking, Seat
from app.schemas.serializers import serialize_booking
from app.services.seat_lock_service import get_lock_holder, set_cache_status
from app.utils.ids import get_integer_id
from app.utils.timefmt import utcnow_naive

log = logging.getLogger(__name__)


async def reap_abandoned_bookings(
    db: AsyncSession, r: Redis, bookings: list[Booking], seats: dict[int, Seat]
) -> None:
    """Cancel checkouts the user opened and walked away from.

    Self-healing on read, the same approach ``seat_map_service.load_and_heal``
    already takes for the seat cache: no sweeper, no timer, no extra process --
    the staleness is repaired by the next person who looks at it.

    A booking counts as abandoned only when **all three** hold:

    1. it is still PENDING;
    2. ``providerPaymentId`` is empty -- nothing signed and verified ever came
       back for it;
    3. the seat lock is gone, or is now held by somebody else.

    (2) is the one that matters. Pay at 4:58 of a five-minute window and the
    lock can expire at 5:00 while the confirm job is still in flight, so
    "PENDING with no lock" on its own would cancel a booking that was genuinely
    paid for. ``/api/payment/verify`` commits the payment id *before* it queues
    that job, so a verified payment is never mistaken for an abandoned one.

    The mirror case is safe too: the worker sets CONFIRMED before it deletes the
    lock, so a successful payment never passes through this state at all.

    A booking that is PENDING *with* a payment id is deliberately left alone.
    Money changed hands and something then failed -- that wants a human, and
    silently cancelling it would hide the problem.
    """
    candidates = [b for b in bookings if b.status == "PENDING" and not b.providerPaymentId]
    if not candidates:
        return

    reaped = False
    for booking in candidates:
        seat = seats.get(booking.seatId)
        if seat is None:
            continue

        # The lock's value is the holder's user id, so this distinguishes "still
        # paying" from "someone else has taken this seat since".
        holder = await get_lock_holder(r, seat.eventId, seat.id)
        if holder is not None and get_integer_id(holder) == booking.userId:
            continue  # checkout still open, still theirs

        booking.status = "CANCELLED"
        booking.paymentStatus = "UNPAID"
        booking.updatedAt = utcnow_naive()
        reaped = True
        log.info(
            "Reaped abandoned booking %s (seat %s): checkout was never paid",
            booking.id,
            seat.id,
        )

    if reaped:
        await db.commit()


async def get_my_bookings(db: AsyncSession, r: Redis, user_id: int) -> list[dict[str, Any]]:
    bookings = (
        (
            await db.execute(
                select(Booking)
                .options(selectinload(Booking.seat).selectinload(Seat.event))
                .where(Booking.userId == user_id)
                .order_by(Booking.id.asc())
            )
        )
        .scalars()
        .all()
    )

    # Settle stale checkouts before rendering, so the page never shows a
    # "Pending" ticket that nothing will ever resolve.
    await reap_abandoned_bookings(
        db, r, list(bookings), {b.seat.id: b.seat for b in bookings if b.seat}
    )

    return [
        serialize_booking(b, seat=b.seat, event=b.seat.event if b.seat else None) for b in bookings
    ]


async def get_booking_by_id(
    db: AsyncSession, r: Redis, booking_id: int, user_id: int
) -> dict[str, Any]:
    booking = (
        await db.execute(
            select(Booking).options(selectinload(Booking.seat)).where(Booking.id == booking_id)
        )
    ).scalar_one_or_none()
    if booking is None:
        raise ApiError(404, "Booking not found")
    # 404 rather than 403 for a foreign booking, so as not to confirm that
    # someone else's booking id exists.
    if booking.userId != user_id:
        raise ApiError(404, "Unauthorized")

    # Reaped here as well as in the list, so the two endpoints cannot disagree
    # about the same booking. This is also the endpoint the checkout page polls,
    # which is how a user whose lock expired mid-payment learns about it.
    if booking.seat is not None:
        await reap_abandoned_bookings(db, r, [booking], {booking.seat.id: booking.seat})

    return serialize_booking(booking, seat=booking.seat)


async def cancel_booking(
    db: AsyncSession, r: Redis, booking_id: int, user_id: int
) -> dict[str, Any]:
    booking = (
        await db.execute(select(Booking).where(Booking.id == booking_id))
    ).scalar_one_or_none()
    if booking is None:
        raise ApiError(400, "Booking not found")
    if booking.userId != user_id:
        # Typo preserved intentionally -- client code may key off this exact string.
        raise ApiError(400, "Unathorised")

    seat = (await db.execute(select(Seat).where(Seat.id == booking.seatId))).scalar_one_or_none()

    booking.status = "CANCELLED"
    booking.updatedAt = utcnow_naive()
    # paymentStatus is deliberately left alone: there is no refund flow, so a
    # cancelled booking still reflects whether it was ever paid.
    if seat is not None:
        seat.status = "AVAILABLE"
    await db.commit()
    await db.refresh(booking)

    if seat is not None:
        await set_cache_status(r, seat.eventId, seat.id, "AVAILABLE")

    # No `seat` key here, unlike other booking responses -- the frontend
    # doesn't need it for a cancellation confirmation.
    return serialize_booking(booking)
