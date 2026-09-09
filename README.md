# PrestoPass

_Get your pass, presto._

A high-concurrency event ticketing system built to handle flash-sale traffic like a Coldplay Concert or an IPL final - without ever overselling seats. The platform combines a **virtual waiting room**, **atomic Redis seat locks**, **async payment processing**, and **real-time WebSocket updates** for the seats and the virtual waiting room so thousands of users can compete for limited inventory seats while the system stays consistent.

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [System Architecture](#system-architecture)
- [Queueing Strategy](#queueing-strategy)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Data Model](#data-model)
- [Redis Key Design](#redis-key-design)
- [API Overiview](#api-overview)
- [Getting Started](#getting-started)
- [Frontend Routes](#frontend-routes)
- [Load Test Overview](#load-testing)
- [Deployment](#deployment)
- [License](#license)

- [Getting Started With LoadTests](./server/loadtests/README.md#get-started-with-tests)

---

## Executive Summary

When ticket demand spikes, most booking systems fail in predictable ways: double bookings, stale seat maps, and login bottlenecks. This project addresses those failure modes with a layered architecture:

| Layer                       | Role                                                                       |
| ---------------------------- | -------------------------------------------------------------------------- |
| **PostgreSQL + SQLAlchemy** | Source of truth for users, events, seats, and CONFIRMED bookings           |
| **Redis**                   | Hot-path seat locks, seat-map cache, and waiting-room queue state          |
| **Lua scripts**             | Atomic lock acquire/release — no race conditions on contested seats        |
| **taskiq**                  | Async payment jobs so checkout does not block the API under load           |
| **Socket.IO**               | Live queue position, seat status, and booking confirmation to every client |

The result is a booking flow that mirrors how production ticketing platforms behave during a drop: users wait in line, a capped number enter the seat map at once, seats are held with a TTL, and payment is processed in the background (through a real gateway order/verify handshake, not a simulated delay) with full rollback on failure.

---

## System Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                         Next.js Frontend (port 4000)                    │
│  Auth · Events · Seat Map · Waiting Room UI · Admin Dashboard           │
│  Socket.IO client (real-time) + Axios (REST) + polling fallback         │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ HTTP / WebSocket
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              FastAPI + python-socketio API (port 5000)                  │
│  Auth · Events · Seats · Bookings · Payments                            │
└───┬─────────────┬──────────────┬──────────────┬─────────────────────────┘
    │             │              │              │
    ▼             ▼              ▼              ▼
 PostgreSQL     Redis         taskiq        Socket.IO
 (SQLAlchemy) locks · cache   payment       broadcast rooms
             · waiting queue  worker
             · active users
```

### Booking Flow (Happy Path)

```text
1. User opens event → enters virtual waiting room (if at capacity)
2. Promoted to ACTIVE → seat map served from Redis hash cache
3. User selects seat → POST /lock → Lua script atomically locks seat (TTL)
4. User clicks Pay Now → POST /payment/order opens a gateway order (mock or Razorpay test mode)
5. Browser completes checkout → POST /payment/verify checks the signature, enqueues a taskiq job
6. Payment worker confirms booking in a DB transaction, updates cache, frees the active-pool slot
7. Socket.IO pushes booking_confirmed + seat_status_changed to all viewers
8. Next user in waiting queue is promoted automatically
```

A `POST /payment/webhook` sits alongside `/verify` as the authoritative fallback — it settles the same booking if the browser never comes back after paying, so both the callback and the webhook race the same conditional `UPDATE ... WHERE status = 'PENDING'`; whichever lands first wins and the other is a no-op.

### Concurrency Safeguards

- **Atomic seat locks** — Redis `SET key userId EX ttl NX` via Lua; only the lock holder can release or pay.
- **No overselling** — DB seat status is checked before lock; the payment worker's confirming update is itself conditioned on `status = 'PENDING'`, so a duplicate settlement (verify racing the webhook) matches zero rows instead of double-confirming.
- **Virtual waiting room** — Redis sorted set (`waiting_queue`) + active user set capped at `MAX_ACTIVE_USERS`.
- **Cache self-healing** — Seat map endpoint reconciles Redis hash vs. live lock keys and repairs drift in the background.
- **Graceful disconnect** — Socket disconnect removes user from queue/active pool and promotes the next waiter.

---

## Queueing Strategy

PrestoPass uses **two separate queues** that solve different problems during a flash sale:

| Queue                    | Technology              | Purpose                                                                                              |
| ------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| **Virtual waiting room** | Redis sorted set + set  | Admission control — caps how many users can view and interact with the seat map at once              |
| **Payment queue**        | taskiq (Redis-backed)   | Async payment confirmation — keeps DB commits and Socket.IO fan-out off the HTTP request path         |

Both are for per-event (waiting room) or per-booking (payment), and both push live status to the client over Socket.IO with polling fallbacks.

---

### 1. Virtual Waiting Room (Seat Map Admission)

When a user opens an event page, the first call to `GET /api/events/:eventId/seats` acts as the **entry gate**. The server sees whether the user is **ACTIVE** (can see the seat map) or **WAITING** (held in line).

#### Data structures

```text
waiting_queue:{eventId}   →  Redis Sorted Set   (member = userId, score = join timestamp)
active_users:{eventId}    →  Redis Set          (members currently viewing the seat map)
```

- **FIFO ordering** — users are scored by the join timestamp. `ZRANGE` always returns the earliest joiners first.
- **Idempotent join** — `ZADD NX` ensures a user is only enqueued once, even if they refresh or poll repeatedly.
- **Key expiry** — `waiting_queue:{eventId}` gets a 24-hour TTL (`QUEUE_TTL_SECONDS`) on first use so stale keys do not linger forever.

#### Admission flow

```text
User hits GET /events/:id/seats
        │
        ▼
Already in active_users? ──yes──► Return 200 ACTIVE + seat map
        │
       no
        │
        ▼
ZADD waiting_queue (NX, score = timestamp)
        │
        ▼
Vacancies = MAX_ACTIVE_USERS − scard(active_users)
        │
        ▼
Promote top N users from queue → active_users (remove from queue)
        │
        ▼
User in active_users? ──yes──► Return 200 ACTIVE + seat map
        │
       no
        │
        ▼
Return 202 WAITING + queuePosition (ZRANK + 1)
```

`MAX_ACTIVE_USERS` defaults to **5** in `server/app/constants.py`. Only that many users can hold an active seat-map slot at the same time; everyone else waits in line.

#### When slots open up (promotion triggers)

The helper `promote_queue_and_notify()` in `app/services/queue_service.py` runs whenever a vacancy appears. It computes vacancies (`MAX_ACTIVE_USERS − active count`), moves the top N waiters from the sorted set into `active_users`, emits `queue_promoted` to each promoted user (via their `user:{userId}` Socket.IO room), and emits `queue_update` with new positions to everyone still waiting. `queue_moved` is broadcast to the event queue room for observability.

Promotion is triggered when a user **leaves the active pool**, which happens on:

| Event                   | Source                                                       |
| ----------------------- | -------------------------------------------------------------- |
| Payment succeeds        | Payment worker removes user from `active_users`               |
| Payment fails / declined | Verify or webhook releases the seat and removes the user      |
| User releases seat lock | Seats router (cancel reservation)                              |
| Socket disconnect       | Socket.IO server — user removed from queue **and** active pool |
| Explicit leave          | `leave_event_queue` Socket event                                |

This keeps the active pool size correct: a user occupies a slot while seeing the map, locking a seat, and paying — and frees it when they finish, fail, abandon, or disconnect.

#### User identity in the queue

- **Authenticated users** — identified by JWT `userId`
- **Guests** — identified by `x-guest-session-id` header or `guest_session` httpOnly cookie (auto-created on first visit)

Both use the same Redis keys; guests participate in the waiting room without an account.

#### Real-time updates and fallback

| Transport        | When used                                  | Interval                             |
| ---------------- | ------------------------------------------ | ------------------------------------- |
| **Socket.IO**    | Authenticated users with a valid JWT token | Instant                              |
| **HTTP polling** | Guests, or when WebSocket connection fails | Every 5 s (`QUEUE_POLL_INTERVAL_MS`) |

Frontend events handled on `/events/[id]`:

- `queue_update` — position changed while waiting
- `queue_promoted` — user moved to ACTIVE; seat map is fetched immediately
- `queue_moved` — general queue movement broadcast (logging / debugging)

While waiting, the UI shows `MapQueuePanel` with live position; on promotion it swaps to the interactive seat grid.

#### Startup cleanup

On Redis connect, the API scans and deletes all `waiting_queue:*` and `active_users:*` keys. This prevents ghost queue state from surviving a server restart when in-memory Socket connections are already gone. This runs in the **API process only** — running it in the worker too would wipe live queues on every worker restart.

---

### 2. Payment Queue (taskiq)

Once a user is **ACTIVE**, locks a seat, and clicks **Pay Now**, they move to a second queue — this one is for **payment settlement**, not seat-map admission.

#### Flow

```text
POST /api/payment/order
        │
        ▼
Create PENDING booking (price snapshotted from Event.price) + open a gateway order
        │
        ▼
Browser completes checkout — Razorpay Checkout (UPI | Card) or the built-in mock sheet
        │
        ▼
POST /api/payment/verify   → HMAC signature check
        │
        ├── invalid  → booking CANCELLED, seat released back to the pool
        └── valid    → enqueue job → taskiq payment worker, return 202 Accepted
                              │
                              ▼
                  Payment worker picks up job (concurrency: 100)
                              │
                  ├── emit payment_processing  →  user
                  ├── SQLAlchemy transaction: seat BOOKED, booking CONFIRMED + PAID
                  │     (guarded by WHERE status = 'PENDING')
                  ├── update Redis seat cache, delete seat lock
                  ├── remove user from active_users
                  ├── promote_queue_and_notify()  →  next waiter enters seat map
                  └── emit booking_confirmed + seat_status_changed
```

`POST /api/payment/webhook` runs the same settle-or-release logic as the authoritative fallback for a payment whose browser never returns — it is the only path that catches a user who pays and immediately closes the tab.

On failure or a declined payment, the seat lock is released, the user is removed from the active pool, the next user is promoted, and `booking_failed` is emitted.

#### Why a separate payment queue?

- The HTTP handler for `/verify` returns almost immediately (`202 Accepted`) instead of blocking on the DB write and the outbound Socket.IO fan-out.
- taskiq buffers spikes — during a large flash sale, confirmation jobs queue safely while the worker drains at controlled concurrency.
- See the [load test report](./server/loadtests/README.md) for real, measured latency and throughput numbers rather than assumed ones.

The frontend `PaymentQueuePanel` tracks the job lifecycle: **waiting → processing → success / failed**, driven by Socket.IO events with a booking-status poll as backup.

---

### 3. How the two queues interact

```text
                    ┌─────────────────────────┐
  Thousands of      │  Virtual Waiting Room   │  MAX_ACTIVE_USERS = 5
  concurrent        │  (Redis FIFO queue)     │  at a time on seat map
  visitors  ──────► └───────────┬─────────────┘
                                │ promoted
                                ▼
                    ┌─────────────────────────┐
                    │  Seat map + lock seat   │
                    └───────────┬─────────────┘
                                │ Pay Now → order → verify
                                ▼
                    ┌─────────────────────────┐
  API stays fast    │  taskiq payment queue   │  Worker confirms in DB
  (202 Accepted)    │  (async settlement)     │  and frees waiting-room slot
                    └─────────────────────────┘
```

The waiting room protects **read and lock endpoints** from unbounded concurrency. The payment queue protects **write-heavy checkout** from blocking HTTP threads. Together they mirror how production ticketing platforms serialize access during a drop while still processing payments reliably in the background.

---

## Features

### For Customers

- **Account management** — Email/password registration and login with JWT (httpOnly cookie + Bearer token support)
- **Google OAuth** — Sign in with Google; accounts linked by email when applicable
- **Event discovery** — Browse upcoming events with availability, featured a carousel on home
- **Interactive seat map** — 10-column grid with live AVAILABLE / LOCKED / BOOKED states
- **Virtual waiting room** — Queue position with WebSocket updates and polling fallback
- **Timed seat reservation** — Countdown timer while seat is locked; auto-release on timeout and expiry
- **Real checkout flow** — UPI + card via Razorpay test mode, or a built-in mock provider with no keys needed; async confirmation with live status (processing → confirmed / failed)
- **My Bookings** — View and filter bookings; cancel confirmed reservations

### For Admins

- **Protected admin dashboard** — Role-gated (`ADMIN`) event management UI
- **Event CRUD** — Create, edit, and delete events with auto-generated seats and a per-event ticket price
- **Seat provisioning** — Seats created in PostgreSQL and pre-warmed into Redis on event creation
- **Client-side search** — Filter events by name or venue in the admin panel

### Real-Time Events (Socket.IO)

| Event                 | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| `queue_update`        | Waiting-room position changed                          |
| `queue_promoted`      | User moved from queue to active seat-map access        |
| `seat_status_changed` | Seat locked, released, or booked — updates all viewers |
| `payment_processing`  | Payment job picked up by worker                        |
| `booking_confirmed`   | Ticket confirmed after successful payment              |
| `booking_failed`      | Payment failed or declined; seat released back to pool |

---

## Tech Stack

| Area               | Technologies                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| **Frontend**        | Next.js 16, React 19, TypeScript, Tailwind CSS 4, Socket.IO Client, Axios, Motion, shadcn/ui   |
| **Backend**         | Python, FastAPI, SQLAlchemy 2 (async, asyncpg), Alembic                                        |
| **Database**        | PostgreSQL                                                                                     |
| **Cache & Queues**  | Redis (redis-py, `redis.asyncio`), taskiq + taskiq-redis                                       |
| **Auth**            | JWT (PyJWT), bcrypt, Authlib Google OAuth 2.0                                                  |
| **Payments**        | Razorpay test mode (UPI + card), or a built-in mock provider — selected by `PAYMENT_PROVIDER`  |
| **Real-time**       | python-socketio                                                                                |

---

## Project Structure

```text
ticket-book/
├── server/                  # FastAPI backend — see server/README.md for full detail
│   ├── loadtests/           # k6 scripts and the load test report
│   ├── alembic/             # Schema migrations (raw SQL revisions)
│   └── app/
│       ├── main.py          # FastAPI app, lifespan, Socket.IO ASGI composition
│       ├── config.py        # pydantic-settings; reads .env
│       ├── constants.py     # Redis key names, lock TTL, waiting-room size
│       ├── db.py            # async engine / sessionmaker / get_db dependency
│       ├── redis_client.py  # Redis client, registered Lua scripts, startup cleanup
│       ├── realtime.py      # process-agnostic emit() — the API/worker seam
│       ├── socket_server.py # Socket.IO server, rooms, handshake auth
│       ├── oauth.py         # Google OAuth (Authlib)
│       ├── lua/             # lockSeat.lua, releaseLock.lua — the anti-oversell guarantee
│       ├── models/          # SQLAlchemy models mapped 1:1 to the physical schema
│       ├── schemas/         # request models + serializers.py (the exact JSON contract)
│       ├── routers/         # health, auth, events, seats, bookings, payment
│       ├── services/        # business logic (seat lock, queue, payment provider)
│       ├── tasks/           # taskiq broker + the payment confirmation job
│       ├── utils/           # ids, natural sort, datetime formatting
│       └── scripts/         # seed.py, generate_dummy_users.py
├── frontend/
│   └── src/
│       ├── app/             # Next.js App Router pages
│       ├── components/      # UI, admin, queue panels, checkout (Razorpay + mock)
│       ├── context/         # AuthContext
│       ├── lib/             # API client, Socket.IO, types, money formatting
│       └── middleware/      # AdminProtect
└── README.md
```

---

## Data Model

```text
User ──< Booking >── Seat >── Event
```

| Model       | Key Fields                                                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User**    | `name`, `email`, `passwordHash?`, `googleId?`, `role` (`CUSTOMER` \| `ADMIN`)                                                                                  |
| **Event**   | `name`, `venue`, `date`, `totalSeats`, `imageUrl`, `price` (INTEGER paise, flat per seat)                                                                     |
| **Seat**    | `seatNumber`, `status` (`AVAILABLE` \| `LOCKED` \| `BOOKED`)                                                                                                   |
| **Booking** | `status` (`PENDING` \| `CONFIRMED` \| `CANCELLED`), `paymentStatus` (`UNPAID` \| `PAID` \| `REFUNDED`), `amount`, `currency`, `paymentProvider`, `providerOrderId`, `providerPaymentId`, `paymentMethod` |

Money is stored as an **integer in paise**, never a float — `149900` renders as `₹1,499`. This is also the unit Razorpay's API takes, so no conversion crosses the wire.

---

## Redis Key Design

| Key Pattern                    | Type         | Purpose                                        |
| ------------------------------- | ------------ | ----------------------------------------------- |
| `seat_lock:{eventId}:{seatId}` | String (TTL) | Holds `userId` of lock owner                   |
| `event_seats:{eventId}`        | Hash         | Cached seat map (`seatId → seatNumber:status`) |
| `waiting_queue:{eventId}`      | Sorted Set   | FIFO queue scored by join timestamp            |
| `active_users:{eventId}`       | Set          | Users currently viewing the seat map           |

Configurable constants live in `server/app/constants.py`:

- `LOCK_TTL_SECONDS` — payment window duration for a held seat
- `MAX_ACTIVE_USERS` — concurrent users allowed past the waiting room
- `QUEUE_TTL_SECONDS` — waiting-room key expiry (24 h)

---

## API Overview

### Auth — `/api/auth`

| Method | Endpoint           | Description                           |
| ------ | ------------------- | -------------------------------------- |
| `POST` | `/register`        | Create account                        |
| `POST` | `/login`           | Login, returns JWT                    |
| `GET`  | `/me`              | Current user profile (auth required)  |
| `GET`  | `/google`          | Initiate Google OAuth                 |
| `GET`  | `/google/callback` | OAuth callback → redirect to frontend |

### Events — `/api/events`

| Method   | Endpoint          | Auth     | Description                                                      |
| -------- | ------------------ | -------- | ------------------------------------------------------------------ |
| `GET`    | `/`               | Public   | List all events with availability                                |
| `GET`    | `/:eventId`       | Public   | Single event details                                             |
| `GET`    | `/:eventId/seats` | Optional | Seat map or waiting-room response (`202 WAITING` / `200 ACTIVE`) |
| `POST`   | `/`               | Admin    | Create event + seats (incl. `price`)                             |
| `PUT`    | `/:eventId`       | Admin    | Update event (update seats/price with constraints)                |
| `DELETE` | `/:eventId`       | Admin    | Delete event + seats (with constraints)                          |

### Seats — `/api/seats`

| Method   | Endpoint                 | Auth | Description                      |
| -------- | -------------------------- | ---- | ---------------------------------- |
| `POST`   | `/:eventId/:seatId/lock` | User | Atomically reserve (lock) a seat |
| `DELETE` | `/:eventId/:seatId/lock` | User | Cancel reservation                |

### Payment — `/api/payment`

| Method | Endpoint   | Auth  | Description                                                                          |
| ------ | ----------- | ----- | --------------------------------------------------------------------------------------- |
| `POST` | `/order`   | User  | Create the PENDING booking (price snapshotted) and open a gateway order              |
| `POST` | `/verify`  | User  | Verify the gateway's signed callback and enqueue the confirmation job (`202`)         |
| `POST` | `/webhook` | None* | Authoritative gateway callback — the fallback when the browser never returns          |

\* No user auth dependency — the HMAC signature over the raw request body is the credential.

### Bookings — `/api/bookings`

| Method   | Endpoint | Auth | Description          |
| -------- | -------- | ---- | ---------------------- |
| `GET`    | `/my`    | User | List user's bookings |
| `GET`    | `/:id`   | User | Get single booking   |
| `DELETE` | `/:id`   | User | Cancel booking       |

### Health

| Method | Endpoint  | Description                     |
| ------ | --------- | ---------------------------------- |
| `GET`  | `/health` | API + Redis connectivity check (mounted at the root, not under `/api`) |

---

## Getting Started

Prerequisites: **Python 3.13** with **uv**, **Node.js 20+**, **Docker & Docker Compose**, and **k6** if you want to run the load tests.

```powershell
git clone https://github.com/Abhishek-k03/PrestoPass.git
cd PrestoPass

# Backend
cd server
docker compose up -d                 # Postgres on 5433, Redis on 6379
uv sync
cp .env.example .env
uv run alembic upgrade head
uv run python -m app.scripts.seed --admin admin@test.com adminpass
```

Then run the API and the payment worker, each in its own terminal:

```powershell
uv run python run.py                 # API + Socket.IO  -> http://localhost:5000
uv run taskiq worker app.tasks.broker:broker app.tasks.payment --max-async-tasks 100
```

Both are required — without the worker, every booking stays `PENDING` forever.

```powershell
# Frontend, in a third terminal
cd ../frontend
npm install
npm run dev                          # http://localhost:4000
```

`frontend/.env.local` needs `NEXT_PUBLIC_API_URL=http://localhost:5000` (it already defaults to that).

Promote a user to admin after registering via the UI:

```sql
UPDATE "User" SET role = 'ADMIN' WHERE email = 'your@email.com';
```

`PAYMENT_PROVIDER` defaults to `mock`, which needs no keys and works fully offline. To exercise the real Razorpay test-mode checkout, set `PAYMENT_PROVIDER=razorpay` and the three `RAZORPAY_*` keys in `server/.env` — see the environment table in [`server/README.md`](./server/README.md).

Full backend detail — architecture, environment variables, database notes, the cross-process Socket.IO seam — lives in [`server/README.md`](./server/README.md).

In order to get started with load testing locally -
[View Documentation](server/loadtests/README.md#get-started-with-tests)

---

## Frontend Routes

| Route                 | Description                                    |
| ----------------------- | ------------------------------------------------- |
| `/`                   | Redirects to `/events` or `/login`             |
| `/login`, `/register` | Authentication                                 |
| `/home`               | Featured events carousel                       |
| `/events`             | All upcoming events                            |
| `/events/[id]`        | Event detail, waiting room, seat map, checkout |
| `/bookings`           | User's ticket history                          |
| `/admin`              | Admin event management (ADMIN only)            |
| `/auth/callback`      | Google OAuth token handoff                     |

---

## Design Decisions Worth Highlighting

1. **Redis-first seat map reads** — Under load, the seat map is served from an in-memory Redis hash cache rather than hitting PostgreSQL on every poll. PostgreSQL remains authoritative for CONFIRMED bookings.

2. **Lua over application-level locking** — Lock acquire and release are single round-trip atomic operations, eliminating check-then-set races that cause double bookings.

3. **Waiting room as admission control** — Capping active users (`MAX_ACTIVE_USERS`) prevents the seat map and lock endpoints from being hammered by unbounded concurrent traffic during a flash sale.

4. **taskiq decouples payment settlement from HTTP** — `/verify` returns as soon as the signature checks out; a background worker runs the DB transaction and broadcasts results over WebSockets (to both the user booking and to everyone viewing the seat map).

5. **Order/verify/webhook instead of a single "pay" call** — a real gateway means the browser can complete payment and then never come back (closed tab, crashed network). The webhook is the authoritative settlement path for exactly that case; `/verify` is the fast path for everyone else. Both write through the same conditional `UPDATE ... WHERE status = 'PENDING'`, so whichever arrives first wins and the other is a no-op.

6. **Dual transport for queue updates** — Authenticated users get live Socket.IO updates; guests and fallback clients poll every 5 seconds.

7. **Startup queue cleanup** — On Redis connect, stale `waiting_queue:*` and `active_users:*` keys are scanned and cleared to avoid ghost queue state after server restarts.

---

## Load Testing

PrestoPass was built on the assumption that seats will be contested with proof — not just booked. To validate, the booking pipeline (Redis atomic locks → taskiq payment queue → Postgres) was stress-tested with [k6](https://k6.io/) directly against the running stack — no Prometheus, no Grafana. Every number is either k6's own summary or something cross-checked directly against Postgres and the API's own log after the run.

### Global Summary Matrix

| Test                        | What Was Proven                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1. Atomic Lock Race**      | Exactly one winner per seat under a 500-user race for the same seat, zero double-booking. 500/500 clean, cross-checked against the API's own log.                                                                  |
| **2. Flash Sale E2E Flow**    | All 500 seats sold, all 500 bookings `CONFIRMED`, zero overselling under a genuine 2,000-user rush. Found and root-caused a real capacity ceiling: the API's 40-connection DB pool saturates under this load.       |
| **3. Auth Load Baseline**     | `/api/auth/login` under 8 sustained VUs: 100% success, p(95) = 63.08ms against a 500ms bar.                                                                                                                          |
| **4. Seat Expiry (TTL) Leak** | Abandoned locks self-clean via Redis TTL alone, zero locks or inconsistent seats left behind. One threshold nominally failed for reasons fully root-caused to a k6 test-harness artifact, not an application bug.  |
| **5. Event Page Spike Test**  | Read-heavy browsing survived a 2,000-VU anonymous spike with correctness intact (99.98% success); latency broke down under the same DB pool ceiling found in Section 2.                                             |

**What this proves, in one line:** under every load profile actually run — a single-seat race, a full 2,000-user flash sale, an abandoned-seat-lock cycle, an auth baseline, and a 2,000-VU traffic spike — the system never allowed a seat to be booked by more than one user.

### Read the full Concurrency & Load Test Report [HERE](./server/loadtests/README.md)

The full report includes the detailed test objectives, k6 script logic, raw CLI output, and the complete root-cause investigation for every finding above — including the DB connection pool ceiling and the k6 VU-aliasing artifact.

---

## Deployment

[`render.yaml`](./render.yaml) is a Render Blueprint covering the whole stack —
Postgres, Key Value (Redis), the API, and the frontend. The API container runs
the taskiq payment worker alongside uvicorn, supervised so that a dead worker
takes the container down rather than leaving the payment queue unconsumed.

```powershell
# Build and run the server image exactly as it is deployed
cd server
docker build -t prestopass-server .
docker run -p 5000:5000 --env-file .env prestopass-server all   # or: api | worker
```

Step-by-step instructions, the free-plan caveats, and how to split the worker
onto its own service live in [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## License

ISC
