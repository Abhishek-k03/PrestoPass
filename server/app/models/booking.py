from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, Identity, Index, Integer, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import TS3, Base, BookingStatusEnum, PaymentStatusEnum
from app.models.seat import Seat
from app.models.user import User
from app.utils.timefmt import utcnow_naive


class Booking(Base):
    __tablename__ = "Booking"
    # Unique indexes, not constraints -- an exact description of the physical
    # schema. No index on "userId": deliberately absent.
    __table_args__ = (
        Index("Booking_seatId_key", "seatId", unique=True),
        Index("Booking_providerOrderId_key", "providerOrderId", unique=True),
        Index("Booking_providerPaymentId_key", "providerPaymentId", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, Identity(always=False), primary_key=True)
    userId: Mapped[int] = mapped_column(
        ForeignKey("User.id", onupdate="CASCADE", ondelete="RESTRICT"), nullable=False
    )
    # The unique constraint here is the hard, DB-level anti-oversell guarantee:
    # one booking per seat, no matter what happens in Redis.
    seatId: Mapped[int] = mapped_column(
        ForeignKey("Seat.id", onupdate="CASCADE", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        BookingStatusEnum, nullable=False, server_default=text("'PENDING'")
    )
    paymentStatus: Mapped[str] = mapped_column(
        PaymentStatusEnum, nullable=False, server_default=text("'UNPAID'")
    )
    imageUrl: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))

    # ---- payment gateway bookkeeping ----
    # Snapshotted from Event.price when the order is created, not joined at read
    # time: what the ticket cost is a fact about the purchase, and must not move
    # when an admin later edits the event's price.
    amount: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    currency: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'INR'"))
    paymentProvider: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    # Both nullable and both uniquely indexed. Postgres counts NULLs as distinct,
    # so unbooked rows never collide -- and a replayed verify or a duplicated
    # webhook cannot mint a second confirmed booking.
    providerOrderId: Mapped[str | None] = mapped_column(Text, nullable=True)
    providerPaymentId: Mapped[str | None] = mapped_column(Text, nullable=True)
    paymentMethod: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))

    createdAt: Mapped[datetime] = mapped_column(
        TS3, nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
    # NOT NULL with no server default and no trigger -- must be supplied on
    # every write, which is why both `default` and `onupdate` are set below.
    # Note: `onupdate` does NOT fire for a Core on_conflict_do_update, so the
    # payment upsert sets this explicitly in both values() and set_().
    updatedAt: Mapped[datetime] = mapped_column(
        TS3, nullable=False, default=utcnow_naive, onupdate=utcnow_naive
    )

    user: Mapped[User] = relationship(lazy="raise")
    seat: Mapped[Seat] = relationship(lazy="raise")
