from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class OrderIn(BaseModel):
    """Opens a checkout for a seat the caller already holds a lock on.

    The frontend sends ``eventId`` as a *string* and ``seatId`` as a number.
    Both are declared optional so a missing field yields our own 400 message
    instead of Pydantic's 422; lax mode coerces "3" -> 3.
    """

    model_config = ConfigDict(extra="ignore")

    eventId: int | None = None
    seatId: int | None = None
    imageUrl: str | None = None


class VerifyIn(BaseModel):
    """The gateway's callback, relayed by the browser.

    Every field is required: a missing signature must be a rejection, never a
    default that verifies. ``method`` is informational only ("upi" / "card") --
    it is recorded, never trusted.
    """

    model_config = ConfigDict(extra="ignore")

    bookingId: int
    orderId: str
    paymentId: str
    signature: str
    method: str = ""
