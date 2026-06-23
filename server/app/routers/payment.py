from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import realtime
from app.config import settings
from app.constants import REDIS_KEYS, room_seat_map, room_user
from app.db import get_db
from app.deps import get_current_user
from app.errors import ApiError
from app.models import Booking, Event, Seat, User
from app.redis_client import redis_client
from app.schemas.payment import OrderIn, VerifyIn
from app.services.payment_provider import MockProvider, get_provider
from app.services.queue_service import promote_queue_and_notify
from app.services.seat_lock_service import get_lock_holder, set_cache_status
from app.tasks.payment import process_payment
from app.utils.ids import get_integer_id
from app.utils.timefmt import utcnow_naive

log = logging.getLogger(__name__)

router = APIRouter()


async def _release_seat(event_id: int, seat_id: int, user_id: int) -> None:
    """Undo a reservation after a failed or abandoned payment.

    Deliberately the same sequence the worker's compensating transaction uses:
    give the seat back to the cache, drop the lock, free the active-pool slot,
    and let the next person in the waiting room through.
    """
    await set_cache_status(redis_client, event_id, seat_id, "AVAILABLE")
    await redis_client.delete(REDIS_KEYS.seat_lock(event_id, seat_id))
    await redis_client.srem(REDIS_KEYS.active_users(event_id), str(user_id))
    await promote_queue_and_notify(redis_client, event_id)
    await realtime.emit(
        "seat_status_changed",
        {"seatId": seat_id, "status": "AVAILABLE"},
        room=room_seat_map(event_id),
    )


@router.post("/order", status_code=201)
async def create_payment_order(
    payload: OrderIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Open a gateway order for a seat this user currently holds.

    Nothing is charged here. This creates the PENDING booking and the order the
    browser's checkout needs; the money only moves once /verify accepts a signed
    callback.
    """
    if payload.eventId is None or payload.seatId is None:
        raise ApiError(400, "eventId and seatId are required in the request body")

    event_id = payload.eventId
    seat_id = payload.seatId

    seat = (await db.execute(select(Seat).where(Seat.id == seat_id))).scalar_one_or_none()
    if seat is None:
        raise ApiError(404, "Seat not found")
    if seat.status == "BOOKED":
        raise ApiError(400, "Seat is already booked")

    # Paying is only allowed while you still hold the lock -- this is what stops
    # a second user from paying for a seat someone else reserved.
    holder = await get_lock_holder(redis_client, event_id, seat_id)
    if holder is None or get_integer_id(holder) != user.id:
        raise ApiError(
            403,
            "You do not hold the lock on this seat, or the payment window has expired",
        )

    event = (await db.execute(select(Event).where(Event.id == event_id))).scalar_one_or_none()
    if event is None:
        raise ApiError(404, "Event not found")
    if event.price <= 0:
        # A gateway cannot open an order for nothing, and silently booking a free
        # ticket would hide the real problem: an admin has not priced this event.
        raise ApiError(400, "This event has no ticket price set yet")

    provider = get_provider()
    currency = settings.PAYMENT_CURRENCY

    try:
        now = utcnow_naive()
        stmt = (
            pg_insert(Booking)
            .values(
                userId=user.id,
                seatId=seat_id,
                imageUrl=payload.imageUrl or "",
                status="PENDING",
                paymentStatus="UNPAID",
                # The price is snapshotted now: what this ticket costs must not
                # change if an admin edits the event mid-checkout.
                amount=event.price,
                currency=currency,
                paymentProvider=provider.name,
                createdAt=now,
                updatedAt=now,
            )
            .on_conflict_do_update(
                # Leans on the Booking_seatId_key unique index -- the DB-level
                # guarantee that one seat can never yield two bookings.
                index_elements=["seatId"],
                set_={
                    "userId": user.id,
                    "status": "PENDING",
                    "paymentStatus": "UNPAID",
                    "amount": event.price,
                    "currency": currency,
                    "paymentProvider": provider.name,
                    # Cleared so a retried checkout cannot be settled by the
                    # signature from an abandoned earlier attempt.
                    "providerOrderId": None,
                    "providerPaymentId": None,
                    "paymentMethod": "",
                    # Set explicitly: the model's `onupdate` does NOT fire for a
                    # Core on_conflict_do_update, and the column is NOT NULL.
                    "updatedAt": now,
                },
                # imageUrl is deliberately absent -- insert-only, never overwritten.
            )
            .returning(Booking.id)
        )
        booking_id = (await db.execute(stmt)).scalar_one()
        await db.commit()
    except Exception:
        await db.rollback()
        log.exception("Failed to create booking for seat %s", seat_id)
        raise ApiError(500, "An error occurred while initiating payment") from None

    order = await provider.create_order(
        amount=event.price,
        currency=currency,
        receipt=f"booking_{booking_id}",
    )

    await db.execute(
        update(Booking).where(Booking.id == booking_id).values(providerOrderId=order.orderId)
    )
    await db.commit()

    response = {
        "success": True,
        "bookingId": booking_id,
        "orderId": order.orderId,
        "amount": order.amount,
        "currency": order.currency,
        "keyId": order.keyId,
        "provider": provider.name,
        "eventName": event.name,
        "seatNumber": seat.seatNumber,
        "prefill": {"name": user.name, "email": user.email},
    }

    if isinstance(provider, MockProvider):
        # No third party exists to sign the mock's callback, so the server hands
        # the browser a signature it minted itself. That is the simulation, not a
        # weakness in it -- /verify still refuses anything it did not sign.
        response["mockPaymentId"] = mock_payment_id = f"mock_pay_{order.orderId[11:]}"
        response["mockSignature"] = provider.sign(order.orderId, mock_payment_id)

    return response


@router.post("/verify")
async def verify_payment(
    payload: VerifyIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JSONResponse:
    """Accept the gateway's signed callback and hand off to the worker.

    The signature check is the entire security boundary: without it, anyone could
    POST an invented payment id and walk away with a free seat.
    """
    booking = (
        await db.execute(select(Booking).where(Booking.id == payload.bookingId))
    ).scalar_one_or_none()
    if booking is None or booking.userId != user.id:
        raise ApiError(404, "Booking not found")

    seat = (await db.execute(select(Seat).where(Seat.id == booking.seatId))).scalar_one()

    if booking.providerOrderId != payload.orderId:
        raise ApiError(400, "This payment does not belong to that booking")

    provider = get_provider()
    if not provider.verify_callback(
        order_id=payload.orderId,
        payment_id=payload.paymentId,
        signature=payload.signature,
    ):
        log.warning(
            "Rejected payment callback with a bad signature (booking %s)", payload.bookingId
        )
        await db.execute(
            update(Booking)
            .where(Booking.id == booking.id, Booking.status == "PENDING")
            .values(status="CANCELLED", paymentStatus="UNPAID", updatedAt=utcnow_naive())
        )
        await db.commit()
        await _release_seat(seat.eventId, seat.id, user.id)
        raise ApiError(400, "Payment verification failed. Your seat has been released.")

    # Already settled -- a webhook beat the browser here. Report the outcome
    # rather than queueing a second job for the same money.
    if booking.status != "PENDING":
        return JSONResponse(
            content={
                "success": booking.status == "CONFIRMED",
                "message": "This booking has already been processed.",
                "bookingId": booking.id,
                "status": booking.status,
            },
            status_code=200,
        )

    await db.execute(
        update(Booking)
        .where(Booking.id == booking.id)
        .values(
            providerPaymentId=payload.paymentId,
            paymentMethod=payload.method or "",
            updatedAt=utcnow_naive(),
        )
    )
    await db.commit()

    await process_payment.kiq(
        eventId=seat.eventId,
        seatId=seat.id,
        userId=user.id,
        bookingId=booking.id,
        paymentId=payload.paymentId,
        method=payload.method or "",
    )

    # 202: the payment is verified but the booking is only PENDING until the
    # worker confirms it.
    return JSONResponse(
        content={
            "success": True,
            "message": "Payment verified. Confirming your booking in the background.",
            "bookingId": booking.id,
            "status": "PENDING",
        },
        status_code=202,
    )


@router.post("/webhook")
async def payment_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_razorpay_signature: str = Header(default=""),
) -> dict:
    """The authoritative outcome, for when the browser never comes back.

    A user who pays and immediately closes the tab never fires the callback, so
    without this their money is taken and their seat quietly expires. No auth
    dependency -- the gateway is the caller, and the HMAC is the credential.
    """
    # Read the raw bytes BEFORE parsing: the signature covers the exact body that
    # was sent, and re-serialising the parsed JSON changes it.
    raw_body = await request.body()

    provider = get_provider()
    if not provider.verify_webhook(raw_body=raw_body, signature=x_razorpay_signature):
        raise ApiError(400, "Invalid webhook signature")

    try:
        event_payload = json.loads(raw_body)
    except ValueError:
        raise ApiError(400, "Malformed webhook body") from None

    kind = event_payload.get("event", "")
    entity = (
        event_payload.get("payload", {}).get("payment", {}).get("entity", {})
        if isinstance(event_payload.get("payload"), dict)
        else {}
    )
    order_id = entity.get("order_id")
    payment_id = entity.get("id")
    if not order_id:
        return {"success": True, "message": f"Ignored webhook {kind!r} with no order id"}

    booking = (
        await db.execute(select(Booking).where(Booking.providerOrderId == order_id))
    ).scalar_one_or_none()
    if booking is None:
        return {"success": True, "message": "No booking for that order"}

    # Idempotent by construction: only a booking still PENDING can transition, so
    # a redelivered webhook, or one that races the browser callback, is a no-op.
    if booking.status != "PENDING":
        return {"success": True, "message": "Already processed"}

    seat = (await db.execute(select(Seat).where(Seat.id == booking.seatId))).scalar_one()

    if kind == "payment.captured":
        await db.execute(
            update(Booking)
            .where(Booking.id == booking.id)
            .values(
                providerPaymentId=payment_id,
                paymentMethod=entity.get("method", ""),
                updatedAt=utcnow_naive(),
            )
        )
        await db.commit()
        await process_payment.kiq(
            eventId=seat.eventId,
            seatId=seat.id,
            userId=booking.userId,
            bookingId=booking.id,
            paymentId=payment_id or "",
            method=entity.get("method", ""),
        )
        return {"success": True, "message": "Confirming booking"}

    if kind == "payment.failed":
        await db.execute(
            update(Booking)
            .where(Booking.id == booking.id, Booking.status == "PENDING")
            .values(status="CANCELLED", paymentStatus="UNPAID", updatedAt=utcnow_naive())
        )
        await db.commit()
        await _release_seat(seat.eventId, seat.id, booking.userId)
        await realtime.emit(
            "booking_failed",
            {
                "success": False,
                "bookingId": booking.id,
                "seatId": seat.id,
                "message": "Payment failed. Your seat lock has been released.",
            },
            room=room_user(booking.userId),
        )
        return {"success": True, "message": "Booking cancelled"}

    return {"success": True, "message": f"Ignored webhook {kind!r}"}
