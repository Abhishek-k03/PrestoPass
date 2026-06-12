from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class EventCreateIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    venue: str
    date: datetime
    totalSeats: int
    # Ticket price in paise. Defaults to 0 = "not priced yet", which the payment
    # router refuses to open an order on rather than selling a free ticket.
    price: int = 0
    imageUrl: str = ""


class EventUpdateIn(BaseModel):
    """All optional; the router uses ``exclude_unset`` to tell "absent" from "null"."""

    model_config = ConfigDict(extra="ignore")

    name: str | None = None
    venue: str | None = None
    date: datetime | None = None
    totalSeats: int | None = None
    price: int | None = None
    imageUrl: str | None = None
