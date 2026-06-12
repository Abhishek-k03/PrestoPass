"""ORM row -> the exact JSON the frontend expects.

Hand-built dicts, deliberately, rather than Pydantic response models:

* ``_count`` cannot be a Pydantic field name (leading underscore -> treated as
  private and dropped), and the admin page reads ``event._count.seats``.
* Every datetime must go through :func:`iso_z`. Pydantic would serialise a naive
  datetime with no ``Z``, and JS parses an offset-less string as *local* time --
  silently shifting every rendered date by the viewer's UTC offset.
"""

from __future__ import annotations

from typing import Any

from app.models import Booking, Event, Seat, User
from app.utils.timefmt import iso_z


def serialize_user(user: User | Any, *, include_created_at: bool = False) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
    }
    if include_created_at:
        data["createdAt"] = iso_z(user.createdAt)
    return data


def serialize_event(
    event: Event,
    *,
    available_seats: int | None = None,
    seat_count: int | None = None,
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": event.id,
        "name": event.name,
        "venue": event.venue,
        "date": iso_z(event.date),
        "totalSeats": event.totalSeats,
        # Paise. The frontend formats it; nothing server-side ever divides by 100.
        "price": event.price,
        # Never null: the frontend interpolates this straight into a CSS url().
        "imageUrl": event.imageUrl or "",
        "createdAt": iso_z(event.createdAt),
    }
    if seat_count is not None:
        data["_count"] = {"seats": seat_count}
    if available_seats is not None:
        data["availableSeats"] = available_seats
    return data


def serialize_seat(seat: Seat, *, event: Event | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": seat.id,
        # BookingEventCard dereferences booking.seat.eventId with no optional
        # chaining, so these must always be present.
        "eventId": seat.eventId,
        "seatNumber": seat.seatNumber,
        "status": seat.status,
        "createdAt": iso_z(seat.createdAt),
    }
    if event is not None:
        data["event"] = serialize_event(event)
    return data


def serialize_booking(
    booking: Booking,
    *,
    seat: Seat | None = None,
    event: Event | None = None,
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": booking.id,
        "userId": booking.userId,
        "seatId": booking.seatId,
        "status": booking.status,
        "paymentStatus": booking.paymentStatus,
        "imageUrl": booking.imageUrl or "",
        # Paise, snapshotted at purchase. providerPaymentId is deliberately not
        # exposed -- the client has no use for a gateway reference, and it is
        # the input to signature verification.
        "amount": booking.amount,
        "currency": booking.currency,
        "paymentMethod": booking.paymentMethod or "",
        "createdAt": iso_z(booking.createdAt),
        "updatedAt": iso_z(booking.updatedAt),
    }
    if seat is not None:
        data["seat"] = serialize_seat(seat, event=event)
    return data
