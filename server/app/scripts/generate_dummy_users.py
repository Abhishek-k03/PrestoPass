"""Create load-test users and pre-sign a token for each.

    uv run python -m app.scripts.generate_dummy_users
    uv run python -m app.scripts.generate_dummy_users --count 3000

k6 has no way to log in thousands of virtual users without the login itself
becoming the bottleneck being measured, so the tokens are minted here and read
from ``loadtests/users.json`` at test start.

One password hash is computed and shared across every row, so ``loginTest.js``
can log in as any of them too -- hashing once matters, since bcrypt at cost 10
is ~70ms and 3000 individual hashes would take about three and a half minutes.

Tokens come from :func:`app.security.generate_token`, the same function the
login endpoint uses, so they cannot drift from what the API accepts.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db import SessionLocal, engine
from app.models import User
from app.security import generate_token, hash_password

DEFAULT_COUNT = 3000
DEFAULT_PASSWORD = "LoadTest123!"

# loadtests/users.json, resolved from this file: app/scripts/ -> server/ -> loadtests/
DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / "loadtests" / "users.json"


async def generate(count: int, output: Path, password: str) -> None:
    batch_id = f"flashsale_{int(time.time() * 1000)}"
    password_hash = await hash_password(password)

    async with SessionLocal() as session:
        rows = [
            {
                "name": f"K6_User_{i}",
                "email": f"{batch_id}_{i}@test.com",
                "passwordHash": password_hash,
                "role": "CUSTOMER",
            }
            for i in range(count)
        ]

        # ON CONFLICT DO NOTHING on the unique email index -- reruns don't
        # create duplicates.
        await session.execute(
            pg_insert(User).on_conflict_do_nothing(index_elements=["email"]), rows
        )
        await session.commit()

        created = (
            await session.execute(
                select(User.id, User.email)
                .where(User.email.like(f"{batch_id}%"))
                .order_by(User.id.asc())
            )
        ).all()

    print(f"Created {len(created)} users in batch {batch_id}")

    tokens = [{"token": generate_token(uid, email)} for uid, email in created]
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(tokens, indent=2), encoding="utf-8")

    print(f"Wrote {len(tokens)} tokens to {output}")
    print(f"All of them share the password {password!r} if you need to log in as one.")


async def main() -> None:
    parser = argparse.ArgumentParser(description="Seed users and tokens for the k6 load tests.")
    parser.add_argument("--count", type=int, default=DEFAULT_COUNT, help="how many users to create")
    parser.add_argument(
        "--output", type=Path, default=DEFAULT_OUTPUT, help="where to write users.json"
    )
    parser.add_argument(
        "--password", default=DEFAULT_PASSWORD, help="shared password for every user"
    )
    args = parser.parse_args()

    try:
        await generate(args.count, args.output, args.password)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
