"""Initial schema.

Written as raw ``op.execute`` blocks rather than ``op.create_table`` on
purpose: autogenerate mishandles pre-existing native enum types (it emits a
duplicate CREATE TYPE), and raw SQL keeps every identifier, default, and
constraint explicit and reviewable in one place.

Tables use quoted PascalCase names ("User", "Event", ...) and camelCase
columns, matching the JSON contract the frontend expects.

Revision ID: 0001_prisma_parity
Revises:
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0001_prisma_parity"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ---- enum types (quoted PascalCase) ----
    op.execute("""CREATE TYPE "Role" AS ENUM ('CUSTOMER', 'ADMIN')""")
    op.execute("""CREATE TYPE "SeatStatus" AS ENUM ('AVAILABLE', 'LOCKED', 'BOOKED')""")
    op.execute("""CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED')""")
    op.execute("""CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PAID', 'REFUNDED')""")

    # ---- tables ----
    op.execute(
        """
        CREATE TABLE "User" (
            "id" SERIAL NOT NULL,
            "name" TEXT NOT NULL,
            "email" TEXT NOT NULL,
            "passwordHash" TEXT,
            "googleId" TEXT,
            "avatar" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "role" "Role" NOT NULL DEFAULT 'CUSTOMER',

            CONSTRAINT "User_pkey" PRIMARY KEY ("id")
        )
        """
    )
    op.execute(
        """
        CREATE TABLE "Event" (
            "id" SERIAL NOT NULL,
            "name" TEXT NOT NULL,
            "venue" TEXT NOT NULL,
            "date" TIMESTAMP(3) NOT NULL,
            "totalSeats" INTEGER NOT NULL,
            "imageUrl" TEXT NOT NULL DEFAULT '',
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

            CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
        )
        """
    )
    op.execute(
        """
        CREATE TABLE "Seat" (
            "id" SERIAL NOT NULL,
            "eventId" INTEGER NOT NULL,
            "seatNumber" TEXT NOT NULL,
            "status" "SeatStatus" NOT NULL DEFAULT 'AVAILABLE',
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

            CONSTRAINT "Seat_pkey" PRIMARY KEY ("id")
        )
        """
    )
    # "updatedAt" is NOT NULL with no default and no trigger -- the application
    # must supply it on every write.
    op.execute(
        """
        CREATE TABLE "Booking" (
            "id" SERIAL NOT NULL,
            "userId" INTEGER NOT NULL,
            "seatId" INTEGER NOT NULL,
            "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
            "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
            "imageUrl" TEXT NOT NULL DEFAULT '',
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL,

            CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
        )
        """
    )

    # ---- indexes ----
    op.execute("""CREATE UNIQUE INDEX "User_email_key" ON "User"("email")""")
    op.execute("""CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId")""")
    op.execute("""CREATE INDEX "Seat_eventId_status_idx" ON "Seat"("eventId", "status")""")
    op.execute(
        """CREATE UNIQUE INDEX "Seat_eventId_seatNumber_key"
           ON "Seat"("eventId", "seatNumber")"""
    )
    # The hard, DB-level anti-oversell guarantee.
    op.execute("""CREATE UNIQUE INDEX "Booking_seatId_key" ON "Booking"("seatId")""")
    # Deliberately NO index on "Booking"."userId".

    # ---- foreign keys (all ON DELETE RESTRICT ON UPDATE CASCADE) ----
    op.execute(
        """ALTER TABLE "Seat" ADD CONSTRAINT "Seat_eventId_fkey"
           FOREIGN KEY ("eventId") REFERENCES "Event"("id")
           ON DELETE RESTRICT ON UPDATE CASCADE"""
    )
    op.execute(
        """ALTER TABLE "Booking" ADD CONSTRAINT "Booking_userId_fkey"
           FOREIGN KEY ("userId") REFERENCES "User"("id")
           ON DELETE RESTRICT ON UPDATE CASCADE"""
    )
    op.execute(
        """ALTER TABLE "Booking" ADD CONSTRAINT "Booking_seatId_fkey"
           FOREIGN KEY ("seatId") REFERENCES "Seat"("id")
           ON DELETE RESTRICT ON UPDATE CASCADE"""
    )


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS "Booking" CASCADE')
    op.execute('DROP TABLE IF EXISTS "Seat" CASCADE')
    op.execute('DROP TABLE IF EXISTS "Event" CASCADE')
    op.execute('DROP TABLE IF EXISTS "User" CASCADE')
    op.execute('DROP TYPE IF EXISTS "PaymentStatus"')
    op.execute('DROP TYPE IF EXISTS "BookingStatus"')
    op.execute('DROP TYPE IF EXISTS "SeatStatus"')
    op.execute('DROP TYPE IF EXISTS "Role"')
