"""Settles a payment the API has already verified.

The browser pays, ``/api/payment/verify`` checks the signature, and this task
only records what already happened -- it never decides the outcome itself.
The compensating transaction below is what undoes a booking if anything fails
after that point.
"""

from __future__ import annotations

import logging

from sqlalchemy import update
from taskiq import Context, TaskiqDepends

from app import realtime
from app.constants import REDIS_KEYS, room_seat_map, room_user
from app.models import Booking, Seat
from app.services.queue_service import promote_queue_and_notify
from app.services.seat_lock_service import set_cache_status
from app.tasks.broker import broker
from app.utils.timefmt import utcnow_naive

log = logging.getLogger(__name__)


@broker.task(task_name="processPaymentJob")
async def process_payment(
    eventId: int,
    seatId: int,
    userId: int,
    bookingId: int,
    paymentId: str = "",
    method: str = "",
    context: Context = TaskiqDepends(),
) -> None:
    state = context.state
    r = state.redis
    session_factory = state.sessionmaker

    # Emitted as soon as the worker picks up the job, before touching the database.
    await realtime.emit(
        "payment_processing",
        {
            "status": "PROCESSING",
            "bookingId": bookingId,
            "message": "Your payment is being processed...",
        },
        room=room_user(userId),
    )

    try:
        async with session_factory() as session, session.begin():
            # Guarded on PENDING so exactly one caller can settle this booking.
            # The browser callback and the gateway's webhook can both arrive; the
            # first one wins and the second matches zero rows.
            result = await session.execute(
                update(Booking)
                .where(Booking.id == bookingId, Booking.status == "PENDING")
                .values(
                    status="CONFIRMED",
                    paymentStatus="PAID",
                    providerPaymentId=paymentId or None,
                    paymentMethod=method or "",
                    updatedAt=utcnow_naive(),
                )
            )
            settled_here = result.rowcount == 1
            if settled_here:
                await session.execute(update(Seat).where(Seat.id == seatId).values(status="BOOKED"))

        if not settled_here:
            # Someone else already confirmed it. Re-emitting would double-promote
            # the waiting queue and show the user two confirmations.
            log.info("[PaymentWorker] booking %s was already settled; nothing to do", bookingId)
            return

        await set_cache_status(r, eventId, seatId, "BOOKED")
        await r.delete(REDIS_KEYS.seat_lock(eventId, seatId))
        await r.srem(REDIS_KEYS.active_users(eventId), str(userId))
        await promote_queue_and_notify(r, eventId)

        await realtime.emit(
            "booking_confirmed",
            {
                "success": True,
                "bookingId": bookingId,
                "seatId": seatId,
                "message": ("Your payment was processed successfully! Your ticket is confirmed."),
            },
            room=room_user(userId),
        )
        await realtime.emit(
            "seat_status_changed",
            {"seatId": seatId, "status": "BOOKED"},
            room=room_seat_map(eventId),
        )

    except Exception:
        log.exception("[PaymentWorker] failed processing booking %s", bookingId)
        try:
            # Compensating transaction: give the seat back and release the slot.
            # Guarded on PENDING, because the money is real now. If the confirm
            # already committed and a later step failed (Redis unreachable, say),
            # cancelling would strip a ticket the customer has genuinely paid
            # for. A stale cache entry is the far smaller harm, and it heals on
            # the next repopulate; the database stays the source of truth.
            async with session_factory() as session, session.begin():
                reverted = await session.execute(
                    update(Booking)
                    .where(Booking.id == bookingId, Booking.status == "PENDING")
                    .values(
                        status="CANCELLED",
                        paymentStatus="UNPAID",
                        updatedAt=utcnow_naive(),
                    )
                )
                if reverted.rowcount != 1:
                    log.error(
                        "[PaymentWorker] booking %s is already settled; refusing to "
                        "cancel a paid booking. Seat cache may need a repopulate.",
                        bookingId,
                    )
                    return
                await session.execute(
                    update(Seat).where(Seat.id == seatId).values(status="AVAILABLE")
                )

            await set_cache_status(r, eventId, seatId, "AVAILABLE")
            await r.delete(REDIS_KEYS.seat_lock(eventId, seatId))
            await r.srem(REDIS_KEYS.active_users(eventId), str(userId))
            await promote_queue_and_notify(r, eventId)

            await realtime.emit(
                "booking_failed",
                {
                    "success": False,
                    "bookingId": bookingId,
                    "seatId": seatId,
                    "message": "Payment failed. Your seat lock has been released.",
                },
                room=room_user(userId),
            )
            await realtime.emit(
                "seat_status_changed",
                {"seatId": seatId, "status": "AVAILABLE"},
                room=room_seat_map(eventId),
            )
        except Exception:
            log.exception("[PaymentWorker] critical error during payment cleanup")
