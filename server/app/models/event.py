from __future__ import annotations

from datetime import datetime

from sqlalchemy import Identity, Integer, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import TS3, Base


class Event(Base):
    __tablename__ = "Event"

    id: Mapped[int] = mapped_column(Integer, Identity(always=False), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    venue: Mapped[str] = mapped_column(Text, nullable=False)
    date: Mapped[datetime] = mapped_column(TS3, nullable=False)
    totalSeats: Mapped[int] = mapped_column(Integer, nullable=False)
    # Ticket price in **paise**, flat across every seat in the event. Integer,
    # never a float -- money that rounds is money that goes missing. 0 means
    # "not priced yet", and the payment router refuses to open an order on it.
    price: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    imageUrl: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    createdAt: Mapped[datetime] = mapped_column(
        TS3, nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
