"""Seed sample data.

    uv run python -m app.scripts.seed
    uv run python -m app.scripts.seed --admin admin@test.com adminpass

Idempotent -- re-running it will not create a second set of events and shift
every seat id.
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import timedelta

from sqlalchemy import func, select

from app.db import SessionLocal, engine
from app.models import Event, Seat, User
from app.security import hash_password
from app.services.event_service import create_seats
from app.utils.timefmt import utcnow_naive

SAMPLE_PREFIX = "Sample Event Test"

# The query strings on these Unsplash URLs control image sizing, so they are
# not incidental.
#
# Prices are in PAISE: 149900 is Rs 1,499. A seeded event MUST have a non-zero
# price or /api/payment/order rejects it, and the app looks broken on first run.
SAMPLES = [
    (
        f"{SAMPLE_PREFIX} 1",
        "Rio",
        1,
        499900,
        "https://images.unsplash.com/photo-1502136969935-8d8eef54d77b?q=80&w=1169&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    ),
    (
        f"{SAMPLE_PREFIX} 2",
        "Rio",
        500,
        149900,
        "https://plus.unsplash.com/premium_photo-1661306437817-8ab34be91e0c?q=80&w=1170&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    ),
    (
        f"{SAMPLE_PREFIX} 3",
        "Rio",
        100,
        79900,
        "https://images.unsplash.com/photo-1626568941852-70bc179e493e?q=80&w=1074&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    ),
]


async def seed_events() -> None:
    async with SessionLocal() as session:
        existing = (
            await session.execute(
                select(func.count(Event.id)).where(Event.name.like(f"{SAMPLE_PREFIX}%"))
            )
        ).scalar_one()
        if existing:
            print(f"Sample events already present ({existing}); skipping.")
            return

        # The count above already opened a transaction, so commit explicitly
        # rather than opening a nested one with session.begin().
        when = utcnow_naive() + timedelta(days=7)
        for name, venue, total, price, image_url in SAMPLES:
            event = Event(
                name=name,
                venue=venue,
                date=when,
                totalSeats=total,
                price=price,
                imageUrl=image_url,
            )
            session.add(event)
            await session.flush()
            await create_seats(session, event.id, total)
            print(f"  created {name!r} with {total} seat(s) at Rs {price // 100:,}")
        await session.commit()

        total_seats = (await session.execute(select(func.count(Seat.id)))).scalar_one()
        print(f"Seeded {len(SAMPLES)} events, {total_seats} seats total.")


async def seed_admin(email: str, password: str) -> None:
    """Register endpoint hardcodes CUSTOMER, so admin routes need this."""
    async with SessionLocal() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
        password_hash = await hash_password(password)
        if user is None:
            session.add(
                User(
                    name="Admin",
                    email=email,
                    passwordHash=password_hash,
                    role="ADMIN",
                )
            )
            action = "created"
        else:
            user.role = "ADMIN"
            user.passwordHash = password_hash
            action = "promoted"
        await session.commit()
        print(f"Admin {action}: {email}")


async def main() -> None:
    parser = argparse.ArgumentParser(description="Seed sample events and seats.")
    parser.add_argument(
        "--admin",
        nargs=2,
        metavar=("EMAIL", "PASSWORD"),
        help="also create or promote an ADMIN user",
    )
    args = parser.parse_args()

    try:
        await seed_events()
        if args.admin:
            await seed_admin(args.admin[0], args.admin[1])
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
