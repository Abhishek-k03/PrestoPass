from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, Identity, Index, Integer, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import TS3, Base, SeatStatusEnum
from app.models.event import Event


class Seat(Base):
    __tablename__ = "Seat"
    __table_args__ = (
        Index("Seat_eventId_seatNumber_key", "eventId", "seatNumber", unique=True),
        Index("Seat_eventId_status_idx", "eventId", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=False), primary_key=True)
    eventId: Mapped[int] = mapped_column(
        ForeignKey("Event.id", onupdate="CASCADE", ondelete="RESTRICT"), nullable=False
    )
    seatNumber: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        SeatStatusEnum, nullable=False, server_default=text("'AVAILABLE'")
    )
    createdAt: Mapped[datetime] = mapped_column(
        TS3, nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )

    # lazy="raise": an accidental lazy load under async SQLAlchemy surfaces as a
    # confusing MissingGreenlet during serialisation. This makes it loud and
    # immediate instead. Load explicitly with selectinload().
    event: Mapped[Event] = relationship(lazy="raise")
