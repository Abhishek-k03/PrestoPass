"""Declarative base and the shared column types.

Two deliberate choices here:

* **Attribute names mirror the database columns exactly** (``passwordHash``,
  ``seatNumber``, ``paymentStatus``) -- the columns are camelCase and so is the
  JSON contract, so a snake_case layer in between would add two translation
  steps and a whole class of aliasing bugs for no gain.
* **Enums are plain string literals**, not ``enum.Enum``. This sidesteps
  SQLAlchemy's name-vs-value ambiguity and means ``seat.status == "BOOKED"``
  and ``{"status": "BOOKED"}`` both work with no conversion step.
"""

from __future__ import annotations

from sqlalchemy.dialects.postgresql import ENUM as PGEnum
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


TS3 = TIMESTAMP(precision=3, timezone=False)

# Native PG enum types. create_type=False: the Alembic migration owns CREATE TYPE,
# so SQLAlchemy must never try to emit a duplicate.
RoleEnum = PGEnum("CUSTOMER", "ADMIN", name="Role", create_type=False)
SeatStatusEnum = PGEnum("AVAILABLE", "LOCKED", "BOOKED", name="SeatStatus", create_type=False)
BookingStatusEnum = PGEnum(
    "PENDING", "CONFIRMED", "CANCELLED", name="BookingStatus", create_type=False
)
PaymentStatusEnum = PGEnum("UNPAID", "PAID", "REFUNDED", name="PaymentStatus", create_type=False)
