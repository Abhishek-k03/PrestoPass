# `server/` — FastAPI backend

The backend for PrestoPass, speaking an HTTP and Socket.IO contract that
[`../frontend`](../frontend) consumes directly.

| | |
|---|---|
| **API** | FastAPI 0.141 on **port 5000** |
| **DB** | PostgreSQL 16 via SQLAlchemy 2 (async, asyncpg), schema managed by Alembic |
| **Cache / locks / queue** | Redis 7 via redis-py 8 (`redis.asyncio`) |
| **Background jobs** | taskiq + taskiq-redis, in a separate worker process |
| **Realtime** | python-socketio, sharing port 5000 with the REST API |

## Quick start

```powershell
cd server
docker compose up -d                 # Postgres on 5433, Redis on 6379
uv sync
uv run alembic upgrade head
uv run python -m app.scripts.seed --admin admin@test.com adminpass
```

Then run the two processes, each in its own terminal:

```powershell
uv run python run.py                 # API + Socket.IO  -> http://localhost:5000
uv run taskiq worker app.tasks.broker:broker app.tasks.payment --max-async-tasks 100
```

And the frontend:

```powershell
cd ../frontend
npm install
npm run dev                          # http://localhost:4000
```

`frontend/.env.local` needs `NEXT_PUBLIC_API_URL=http://localhost:5000` (it already
defaults to that).

Add `--reload` to `run.py` for auto-reload during development.

## Why `run.py` instead of a plain `uvicorn` command

On Windows, `localhost` resolves to `::1` (IPv6) **before** `127.0.0.1`. `uvicorn --host
0.0.0.0` listens on IPv4 only, so a client that tries IPv6 first stalls for ~2 seconds on
*every request* before falling back — and the frontend talks to `http://localhost:5000`.
`--host ::` has the mirror-image problem, since Windows defaults `IPV6_V6ONLY` to true and
plain IPv4 clients then cannot connect at all.

`run.py` builds the listening socket itself with `IPV6_V6ONLY` cleared, so one listener
serves both families.

## Layout

```
app/
├─ main.py            FastAPI app, lifespan, Socket.IO ASGI composition  (entrypoint)
├─ config.py          pydantic-settings; reads .env
├─ constants.py       Redis key names, lock TTL, waiting-room size
├─ db.py              async engine / sessionmaker / get_db dependency
├─ redis_client.py    Redis client, registered Lua scripts, startup queue cleanup
├─ errors.py          ApiError + the four exception handlers
├─ security.py        bcrypt (threadpooled) + JWT
├─ deps.py            get_current_user / require_admin / guest-session identity
├─ realtime.py        process-agnostic emit()  <- the cross-process seam
├─ socket_server.py   Socket.IO server, rooms, handshake auth
├─ oauth.py           Google OAuth (Authlib)
├─ lua/               lockSeat.lua, releaseLock.lua  -- the anti-oversell guarantee
├─ models/            SQLAlchemy models mapped 1:1 to the physical schema
├─ schemas/           request models + serializers.py (the exact JSON contract)
├─ routers/           health, auth, events, seats, bookings, payment
├─ services/          business logic
├─ tasks/             taskiq broker + the payment job
├─ utils/             ids, natural sort, datetime formatting
└─ scripts/           seed.py, generate_dummy_users.py
```

## How the pieces fit

**Seat locking** is done entirely in Redis by two Lua scripts (`SET key userId EX 300
NX`) — the anti-oversell guarantee, so mutation happens atomically inside the script
rather than as separate read-then-write calls. `Booking.seatId` also carries a unique
index, which is the hard database-level backstop. Locks are non-reentrant: re-locking a
seat you already hold returns 409.

**The waiting room** caps concurrent seat-map viewers at 5 (`MAX_ACTIVE_USERS`) using a
Redis sorted set keyed by join time. Queued callers get **HTTP 202** with their position —
a success status, because the frontend polls on 2xx.

**The seat map** is served from a Redis hash rather than Postgres, and self-heals in both
directions on every read: a cached `LOCKED` with no live lock key reverts to `AVAILABLE`,
and an untracked lock key promotes the cached status to `LOCKED`.

**Payments** are a gateway order → signed callback → worker-settle sequence.
`POST /api/payment/order` opens an order against whichever provider `PAYMENT_PROVIDER`
selects (a built-in mock, or Razorpay test mode), and `POST /api/payment/verify` checks
the signature before handing off to the taskiq worker, which commits the booking and
pushes the result over Socket.IO. `POST /api/payment/webhook` is the authoritative
fallback for a payment whose browser never comes back.

### The cross-process Socket.IO seam

The taskiq worker is a **separate process** and cannot reach the API's in-memory
Socket.IO server, so both sides bind an emitter into `app/realtime.py`:

- the API binds the `AsyncServer` (delivers locally *and* publishes to Redis)
- the worker binds `AsyncRedisManager(..., write_only=True)` (publishes only)

The API's manager subscribes to the same Redis channel and fans messages out to browsers.
`main.py` forces `sio.manager.initialize()` during startup because python-socketio
otherwise starts that subscriber lazily on the first browser connection — and Redis
pub/sub does not buffer, so anything published before then is lost.

## Design notes

- **Error bodies carry both `error` and `message`.** The frontend reads `.error` on the
  login/register/admin pages and `.message` on the booking page, and FastAPI's default
  `{"detail": ...}` body is read by neither.
- **Google OAuth redirects to `FRONTEND_URL`** (port 4000, the frontend's actual dev port).
- **`role` is returned in all three Google-login branches** (find, link, create). The
  frontend persists that object to `localStorage` and its admin guard reads `user.role`,
  so a Google-created admin must come back with one.
- **`GET /api/events` uses one grouped aggregate** rather than a `COUNT` per event.
- **The seed is idempotent** — re-running it will not create a second set of events.
- **A booking you do not own returns 404**, not 403, so as not to confirm someone else's
  booking id exists.
- **Cancelling leaves `paymentStatus` untouched** — there is no refund flow, so a
  cancelled booking still reflects whether it was ever paid.

## Environment

Copy `.env.example` to `.env`. Postgres is on **5433** because a native PostgreSQL
install already owns 5432 on this machine.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `5000` | |
| `DATABASE_URL` | `postgresql+asyncpg://ticket:ticket@localhost:5433/ticket_booking_platform` | asyncpg rejects query-string params on the URL. Pool sizing lives in `db.py`. |
| `REDIS_URL` | `redis://localhost:6379/0` | |
| `JWT_SECRET` | dev value | Must be ≥32 bytes or PyJWT warns. |
| `JWT_EXPIRES_DAYS` | `7` | |
| `SESSION_SECRET` | dev value | Signs the cookie holding Authlib's OAuth state. |
| `FRONTEND_URL` / `FRONTEND_URL_ALT` | `:4000` / `:3000` | CORS origins + the OAuth redirect target. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | empty | Google Sign-In is skipped unless both are set. |
| `SOCKETIO_CHANNEL` | `socketio` | Must match between API and worker. |
| `PAYMENT_PROVIDER` | `mock` | `mock` needs no keys and works offline; `razorpay` needs `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET`. |

## Database

Tables use quoted PascalCase names (`"User"`, `"Event"`, `"Seat"`, `"Booking"`), camelCase
columns, and four native PG enum types. The schema is defined as raw SQL across two
Alembic revisions rather than through `op.create_table`, so every column, default, and
index is explicit and reviewable in one place.

`Booking.updatedAt` is `NOT NULL` with **no** database default and no trigger — the
application sets it on every write, including explicitly inside the payment upsert, since
SQLAlchemy's `onupdate` does not fire for `ON CONFLICT DO UPDATE`.

## Notes

- Requires `socket_timeout=None` on the taskiq broker: `ListQueueBroker.listen()` issues an
  indefinitely blocking `BRPOP`, but redis-py 8's maintenance-notifications feature applies
  a default 5s socket read timeout, and `listen()` only catches `ConnectionError` — so the
  worker would die and restart every 5 idle seconds. See `app/tasks/broker.py`.
- Keep taskiq at one worker process on Windows (its process manager uses `spawn`).
- Startup clears stale `waiting_queue:*` / `active_users:*` keys. That runs in the **API
  only** — doing it in the worker would wipe live queues on every worker restart.
- The k6 suites in `loadtests/` target `http://localhost:5000/api` and run against this
  server. Run the API with `PAYMENT_PROVIDER=mock` for the flash-sale test — the mock
  gateway signs its own callback, so k6 can complete a purchase without a browser.
  Generate the tokens they need with
  `uv run python -m app.scripts.generate_dummy_users`.

## Verifying

```powershell
curl.exe http://localhost:5000/health          # {"status":"ok","redis":"connected"}
docker exec ticket_py_db psql -U ticket -d ticket_booking_platform -c '\d "Booking"'
```

Interactive API docs: <http://localhost:5000/docs>.
