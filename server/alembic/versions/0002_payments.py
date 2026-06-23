"""Payment columns: a price on Event, and gateway bookkeeping on Booking.

Raw ``op.execute`` rather than ``op.add_column``, matching 0001's style -- keeps
every column, default, and index explicit in one place.

Money is INTEGER **paise**, never a float and never a rupee decimal: 149900 is
Rs 1,499. This is also the unit Razorpay's API takes, so no conversion ever
crosses the wire.

Deliberately no new ``PaymentStatus`` value -- PENDING/UNPAID already means
"awaiting the gateway", and ``ALTER TYPE ... ADD VALUE`` cannot run inside the
migration's transaction.

Revision ID: 0002_payments
Revises: 0001_prisma_parity
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0002_payments"
down_revision: str | None = "0001_prisma_parity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # NOT NULL DEFAULT 0 so existing rows migrate without a backfill. Every
    # pre-existing event is therefore priced at zero, and /api/payment/order
    # rejects those with a 400 until an admin sets a real price.
    op.execute("""ALTER TABLE "Event" ADD COLUMN "price" INTEGER NOT NULL DEFAULT 0""")

    # amount is copied from Event.price at order time rather than joined at read
    # time: the ticket's price is what it cost when it was bought, and must not
    # change retroactively when an admin edits the event.
    op.execute(
        """
        ALTER TABLE "Booking"
            ADD COLUMN "amount"            INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN "currency"          TEXT    NOT NULL DEFAULT 'INR',
            ADD COLUMN "paymentProvider"   TEXT    NOT NULL DEFAULT '',
            ADD COLUMN "providerOrderId"   TEXT,
            ADD COLUMN "providerPaymentId" TEXT,
            ADD COLUMN "paymentMethod"     TEXT    NOT NULL DEFAULT ''
        """
    )

    # Nullable, so Postgres treats every NULL as distinct and unbooked rows do
    # not collide. These are what make a replayed verify call or a duplicate
    # webhook delivery a no-op instead of a second ticket.
    op.execute(
        """CREATE UNIQUE INDEX "Booking_providerOrderId_key"
           ON "Booking"("providerOrderId")"""
    )
    op.execute(
        """CREATE UNIQUE INDEX "Booking_providerPaymentId_key"
           ON "Booking"("providerPaymentId")"""
    )


def downgrade() -> None:
    op.execute('DROP INDEX IF EXISTS "Booking_providerPaymentId_key"')
    op.execute('DROP INDEX IF EXISTS "Booking_providerOrderId_key"')
    op.execute(
        """
        ALTER TABLE "Booking"
            DROP COLUMN IF EXISTS "paymentMethod",
            DROP COLUMN IF EXISTS "providerPaymentId",
            DROP COLUMN IF EXISTS "providerOrderId",
            DROP COLUMN IF EXISTS "paymentProvider",
            DROP COLUMN IF EXISTS "currency",
            DROP COLUMN IF EXISTS "amount"
        """
    )
    op.execute('ALTER TABLE "Event" DROP COLUMN IF EXISTS "price"')
