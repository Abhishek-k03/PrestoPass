# PrestoPass — Load Test & Resilience Report

This is the report of every concurrency and load test actually run against PrestoPass's booking pipeline. It proves to answer one question with evidence, not assertion: **can two users ever end up with the same seat?**

All five tests below target the same architectural chain:

```
Client → FastAPI → Redis (atomic seat lock, Lua script) → taskiq (paymentQueue) → payment worker → Postgres (SQLAlchemy transaction)
```

All were run with [k6](https://k6.io/) directly — no Prometheus, no Grafana. Every number below is either k6's own summary or something cross-checked directly against Postgres and the API's own log after the run, not taken on trust from either alone.

> ### About the numbers in this report
>
> All five tests were run on 2026-09-08 against the current stack (FastAPI, SQLAlchemy, taskiq).
>
> Checkout used to be a single `POST /api/payment/pay`; it is now `POST /api/payment/order`
> followed by `POST /api/payment/verify`, because a real payment gateway sits in the flow.
> `flashSaleTest.js` reflects that two-step flow.

## Table of Contents

- [K6](#k6)
- [1. Atomic Lock Race Condition Test](#1-atomic-lock-race-condition-test)
- [2. Flash Sale End-to-End Flow Test](#2-flash-sale-end-to-end-flow-test)
- [3. Auth Load Baseline (Login Test)](#3-auth-load-baseline-login-test)
- [4. Seat Expiry (TTL) Leak Test](#4-seat-expiry-ttl-leak-test)
- [5. Event Page Spike Test](#5-event-page-spike-test)
- [Summary of Findings](#summary-of-findings)
- [Get Started with Tests](#get-started-with-tests)

---

## K6

K6 is an open-source load testing tool used to simulate real-world traffic on APIs and services.

### What K6 Measures

- Response Time
- Number of Requests
- Failure Rate
- Throughput
- Concurrent Users (VUs)

#### Example

```javascript
export const options = {
  vus: 20,
  duration: "30s",
};
```

This simulates **20 users** continuously accessing the API for **30 seconds**.

---

## 1. Atomic Lock Race Condition Test

### Test Objectives & Setup

Proves the single most important accurate property in the whole system: **when many users fight over one seat at the exact same moment, exactly one of them wins — never zero, never more than one. never ever overselling** This is the foundational guarantee that everything else in the booking pipeline depends on.

**Scenario:** Consider 500 users (here VUs) who will be attempting to lock for the EXACT SAME seat (whose config are in the script)

- **Script:** `seatLockTest.js`
- **Executor:** `per-vu-iterations` (all VUs pre-initialized, each fires exactly once, near-simultaneously)
- **Load:** 500 VUs targeting one single, fixed `seatId`

### k6 Script Logic

1. `setup()` registers 500 distinct users once, before any VU starts, and collects back their tokens.
2. Each VU (indexed by `__VU`) fires a single `POST /api/seats/:eventId/:seatId/lock` against the exact same seat, exact same event.
3. Outcome is bucketed into three custom counters: `seat_lock_success`, `seat_lock_conflict`, `seat_lock_unexpected` which should all satify the criteria.
4. A hard threshold counter that must be no matter what asserts `seat_lock_success` count is exactly 1 across the entire run.

Actual mechanism being tested: a Redis `SET key value EX ttl NX` (atomic set-if-not-exists) executed via a Lua script, guaranteeing the check-and-set can't be split by concurrent callers the way a naive `GET` then `SET` could be.

### Empirical Results (The Proof Data)

Run 2026-09-08, from WSL2 (see the methodology note below for why WSL2 rather than native Windows):

```
execution: local
    script: seatLockTest.js
    output: -

scenarios: (100.00%) 1 scenario, 500 max VUs, 1m0s max duration (incl. graceful stop):
           * seat_lock_race: 1 iterations for each of 500 VUs (maxDuration: 30s, gracefulStop: 30s)

THRESHOLDS

seat_lock_conflict
✓ 'count>=9' count=499

seat_lock_success
✓ 'count==1' count=1

seat_lock_unexpected
✓ 'count==0' count=0

TOTAL RESULTS

checks.........................: 100.00% 500 out of 500

✓ response is 200 (won) or 409 (conflict), nothing else

CUSTOM
seat_lock_conflict..............: 499     211.716083/s
seat_lock_success................: 1       0.424281/s
seat_lock_unexpected.............: 0       0/s

HTTP
http_req_duration.................: avg=939.68ms min=53.63ms med=935.16ms max=1.59s p(90)=1.45s p(95)=1.52s
  { expected_response:true }......: avg=629.81ms min=629.81ms med=629.81ms max=629.81ms p(90)=629.81ms p(95)=629.81ms
http_req_failed....................: 99.80% 499 out of 500
http_reqs...........................: 500   212.140364/s

EXECUTION
iteration_duration...................: avg=1.47s min=672.14ms med=1.43s max=2.34s p(90)=2.19s p(95)=2.28s
iterations..............................: 500   212.140364/s
vus........................................: 82    min=82  max=438
vus_max.......................................: 500   min=500 max=500

NETWORK
data_received....................................: 127 kB 54 kB/s
data_sent...........................................: 180 kB 77 kB/s

running (0m02.4s), 000/500 VUs, 500 complete and 0 interrupted iterations
seat_lock_race ✓ [======================================] 500 VUs  02.4s/30s  500/500 iters, 1 per VU
```

**Verdict:** All three custom thresholds passed. Out of all 500 concurrent users targeting the exact same event, exact same seat, in a genuine simultaneous burst, **exactly 1 had the seat locked and 499 received `409 Conflict`** — zero unexpected responses, zero double-booking. This was cross-checked directly against the API's own access log after the run, not just k6's summary: exactly one `200`, the rest clean `409`s, matching k6's count exactly. `http_req_failed` shows 99.80% because k6 counts every non-2xx response (the 409s) as "failed" by default; this is expected and correct — a `409` is the intended outcome for 499 of the 500 requests, not a failure. The relevant number is `seat_lock_unexpected = 0`.

**Methodology note — run this from Linux, not native Windows.** The first attempt at this test ran k6 natively on Windows, and 287 of the 500 requests never reached the server at all — they failed at the TCP connection stage (k6 reports them as `status 0`), a well-known Windows-loopback limitation with firing hundreds of near-simultaneous connections at `localhost`. Of the 213 requests that _did_ reach the server in that run, the result was already identical: 1 success, 212 conflicts, 0 anomalies — the app was never in doubt, only the client's ability to open that many connections at once. Re-running from WSL2 (which reaches the Windows-hosted API via `host.docker.internal`) removed the bottleneck entirely, giving the full, clean 500/500 result above.

Since this is a single near-simultaneous burst against one seat, there's nothing time-series-shaped to plot — the k6 summary above is the complete record.

---

## 2. Flash Sale End-to-End Flow Test

### Test Objectives & Setup

This scenario simulates a high-concurrency flash sale event (such as a major ticket release) to evaluate system behavior under extreme load. The system is tested against **2,000 concurrent users rushing to book a limited pool of 500 seats the instant they go live**. This exercises the entire flow end-to-end: the initial seat lock, the asynchronous payment queue ingestion, and final database transaction confirmation in PostgreSQL.

- **Script:** `flashSaleTest.js`
- **Executor:** `ramping-vus`
- **Load Profile:** 0 → 2,000 VUs over 1 minute (ramp-up) → hold at 2,000 VUs for 3 minutes (sustained plateau) → 2,000 → 0 VUs over 30 seconds (ramp-down with a 10-second graceful ramp-down window).
- **Inventory:** 500 total seats seeded for the target event.

---

### k6 Script Logic

Each Virtual User (VU) acts as a distinct, pre-registered customer utilizing an authenticated token. The execution logic is optimized to mimic actual user action on a checkout layout:

1. **Random Allocation:** The VU randomly selects a seat ID from the active 500-seat pool.
2. **Atomic Seat Locking:** Executes a `POST /api/seats/:eventId/:seatId/lock` request to secure an in-memory Redis atomic lock.
3. **Checkout:** If the lock is successfully acquired (HTTP 200), the VU pays for the seat. This is two calls, not one: `POST /api/payment/order` opens a gateway order, and `POST /api/payment/verify` hands back the signed payment callback. Verification then offloads the transactional workload as an async job onto the taskiq queue.

   > Run the API with `PAYMENT_PROVIDER=mock` for these tests. The mock gateway signs its own callback and returns it on the order, so k6 can complete a purchase with no browser and no third party in the loop. Against `PAYMENT_PROVIDER=razorpay` the test cannot complete a payment, by design — a real checkout needs a real person.
4. **Conflict Resolution:** If a seat is already taken (HTTP 409), the VU increments the conflict counter, cycles back, and targets an alternative seat (up to 3 structural retries per iteration).
5. **Dashboard Verification:** Upon successful verification (HTTP 202), the user waits out the backend synchronization threshold before executing a `GET /api/bookings/my` request to confirm their status updates to `CONFIRMED`.

---

### Empirical Results (The Proof Data)

Run 2026-09-08, from WSL2, with `PAYMENT_PROVIDER=mock` and the taskiq worker running:

```text
execution: local
    script: flashSaleTest.js
    output: -

scenarios: (100.00%) 1 scenario, 2000 max VUs, 4m40s max duration (incl. graceful stop):
           * flash_sale: Up to 2000 looping VUs for 4m30s over 3 stages (gracefulRampDown: 10s)

THRESHOLDS

booking_confirmed_total
✓ 'count==500' count=500

TOTAL RESULTS

✓ gateway order opened (201)
✓ payment verified (202)
checks.........................: 100.00% 1000 out of 1000

CUSTOM
booking_confirmed_total........: 500     1.8708/s
lock_conflict_total.............: 61271  229.251533/s
payment_duration_ms..............: avg=1148.418ms min=-412ms med=668ms max=8767ms p(90)=2854.9ms p(95)=3760.8ms

HTTP
http_req_duration..................: avg=5.14s min=-475417441ns med=5.56s max=30.44s p(90)=11.76s p(95)=14.62s
  { expected_response:true }.......: avg=4.1s  min=-475417441ns med=2.65s max=30.03s p(90)=11.47s p(95)=12.25s
http_req_failed......................: 73.59% 61388 out of 83411
http_reqs...............................: 83411  312.090542/s

EXECUTION
iteration_duration.........................: avg=22.01s min=1.52s med=19.81s max=1m29s p(90)=36.93s p(95)=42.49s
iterations....................................: 20442  76.485774/s
vus...............................................: 12     min=12   max=2000
vus_max...............................................: 2000   min=2000 max=2000

NETWORK
data_received.........................................: 22 MB 81 kB/s
data_sent................................................: 30 MB 113 kB/s

running (4m31.3s), 0000/2000 VUs, 20442 complete and 614 interrupted iterations
flash_sale ✓ [======================================] 0000/2000 VUs  4m30s
```

### Performance & Architecture Analysis

> **Verdict: correctness held completely. One real capacity limit found, and root-caused.**
> Verified directly against Postgres after the run, not just k6's self-report: **exactly
> 500 bookings exist for this event, all `CONFIRMED`/`PAID`, all for distinct seats** —
> zero overselling, zero duplicate seat claims, across 347 distinct buyers. All 500 seats
> show `BOOKED`.

- **Understanding the 73.59% failure rate:** Of 83,411 total requests, 61,271 were `lock_conflict_total` — clients that lost the race for a seat and correctly got `409 Conflict`. That's the _intended_ outcome for the vast majority of attempts under 2,000 users chasing 500 seats, not a defect. It confirms the Redis atomic locking engine absorbed the traffic spike at the caching layer, well before it could reach the database.
- **The remaining failures are real, and precisely counted: 117 requests got `500 Internal Server Error`** — 96 on `POST /seats/:eventId/:seatId/lock`, 21 on `GET /bookings/my`. This was confirmed two independent ways that agree exactly: grepping k6's own per-request error log, and grepping the API's access log by endpoint. Every one of them traces to the same root cause, found directly in the API log:

  ```
  sqlalchemy.exc.TimeoutError: QueuePool limit of size 20 overflow 20 reached,
  connection timed out, timeout 30.00
  ```

  `app/db.py` caps the API's database connection pool at 40 total (`pool_size=20, max_overflow=20`). At the 2,000-VU peak, demand briefly exceeded that, and the excess requests queued for the full 30-second pool timeout before failing. The same 500-VU load in Section 1 never once hit this ceiling — the limit sits somewhere between 500 and 2,000 concurrent requests at the current pool configuration.
- **The failure mode is the right one.** Under saturation, the system returned loud, honest `500`s rather than corrupting any state — not one of those 117 failures produced a wrong seat count, a double lock, or an inconsistent booking. `checks` shows **100.00% (1000 out of 1000)**: every single lock that _did_ succeed went on to open a payment order and get verified without a single failure at either step. The pool exhaustion stayed confined to the two endpoints above and never once reached into an in-flight payment.
- **The worker had zero errors.** `taskiq worker` processed all 500 payment confirmations with no exceptions logged, even while the API was visibly straining.
- **A test-script gap worth naming:** `flashSaleTest.js` doesn't check the status code on its `GET /bookings/my` polling call, so those 21 failures were silently absorbed rather than counted by any k6 metric — they only surfaced by grepping the API's own log. A future revision of the script should assert on that response too.
- **A measurement artifact, not a bug:** the negative minimum durations in the raw output above (`min=-475417441ns`, `payment_duration_ms min=-412ms`) are physically impossible and come from a small clock offset between the WSL2 VM and the Windows host it was testing against — a testing-environment quirk, not a real negative latency.

---

## 3. Auth Load Baseline (Login Test)

### Test Objectives & Setup

A low-concurrency baseline: how `/api/auth/login` behaves under a small, sustained load, with the tightest latency bar in this report (`p(95) < 500ms`).

- **Script:** `loginTest.js`
- **Executor:** default (looping VUs)
- **Load:** 8 VUs, looping continuously for 2 minutes (2m30s max duration including graceful stop)

### k6 Script Logic

Each of the 8 VUs loops continuously for the test duration:

1. `POST /api/auth/login` with one of 8 fixed test accounts, cycled by VU index.
2. Assert the response is `200` and a `token` field exists in the body.
3. `sleep(0.5-1.5s)` before the next iteration.

The 8 accounts (`loadtest1@test.com`..`loadtest8@test.com`) didn't exist in this dev database beforehand and were registered before the run.

### Empirical Results (The Proof Data)

Run 2026-09-08, from WSL2:

```
✓ login successful
✓ token exists

checks.........................: 100.00% 1826 out of 1826
data_received...................: 620 kB  5.2 kB/s
data_sent........................: 195 kB  1.6 kB/s
http_req_blocked.................: avg=27.49µs  min=2.94µs   med=5.35µs   max=2.52ms   p(90)=7.37µs  p(95)=9.72µs
http_req_connecting..............: avg=5.18µs   min=0s       med=0s       max=702.92µs p(90)=0s      p(95)=0s
✓ http_req_duration..............: avg=59.18ms  min=116.95µs med=58.18ms  max=182.96ms p(90)=61.59ms p(95)=63.08ms
    { expected_response:true }...: avg=59.18ms  min=116.95µs med=58.18ms  max=182.96ms p(90)=61.59ms p(95)=63.08ms
http_req_failed...................: 0.00%   0 out of 913
http_req_receiving................: avg=203.67µs min=58.34µs  med=194.23µs max=1.86ms   p(90)=262.1µs p(95)=292.94µs
http_req_sending..................: avg=37.52µs  min=7.41µs   med=35.87µs  max=258.91µs p(90)=56.78µs p(95)=65.97µs
http_req_tls_handshaking..........: avg=0s       min=0s       med=0s       max=0s       p(90)=0s      p(95)=0s
http_req_waiting...................: avg=58.94ms  min=0s       med=57.96ms  max=182.51ms p(90)=61.35ms p(95)=62.8ms
http_reqs...........................: 913     7.65116/s
iteration_duration...................: avg=1.05s min=560.43ms med=1.06s max=1.61s p(90)=1.47s p(95)=1.51s
iterations............................: 913     7.65116/s
vus....................................: 3       min=3  max=8
vus_max.................................: 8       min=8  max=8

running (1m59.3s), 0/8 VUs, 913 complete and 0 interrupted iterations
default ✓ [======================================] 8 VUs  2m0s
```

**Verdict:** Both thresholds passed. `p(95) = 63.08ms`, well inside the 500ms bar — nearly 8x margin. 100% checks (1826 out of 1826 — two checks per iteration, 913 iterations), zero `http_req_failed`.

---

## 4. Seat Expiry (TTL) Leak Test

### Test Objectives & Setup

Proves that an abandoned seat lock — a user who locks a seat and never pays — doesn't leak forever: the lock must expire automatically via Redis TTL and become lockable again, with no manual cleanup and no stuck state under concurrent retry pressure.

- **Script:** `seatAbandonTest.js`
- **Executor:** two `per-vu-iterations` scenarios (a lock wave and a retry wave)
- **Load:** 100 VUs lock 100 distinct seats, followed by a second wave of 100 VUs repeatedly retrying those same seats (10 retries each, ~1.5s apart)
- **TTL:** temporarily lowered to 10s (from the real 300s) for the duration of this run only. Reverted immediately after, and confirmed reverted with a live lock check (`lockExpiresIn: 300`) before anything else touched the server.

**A real bug found and fixed before running:** the script's `SEAT_COUNT` was `601`. Event 3 (the seeded target event) has exactly 100 seats, with database ids `502`–`601` — `601` is the _last seat id_, not the seat _count_, which looks like a copy-paste of the range's endpoint. Left as-is, the script would have tried to lock seat ids up to `1102`, mostly nonexistent. Fixed to `100`.

Nine of Event 3's seats were also left `BOOKED` from earlier, unrelated testing this session — reset to `AVAILABLE` first so the test got the full, clean 100-seat pool its scenario describes.

### k6 Script Logic

1. **Wave one** (100 VUs, 1 iteration each): each VU locks a distinct seat and does nothing else — no `/pay` call, no relock. This is the "abandoned" user.
2. **Wave two** (100 VUs, starting ~1s later): each VU repeatedly retries locking the _same_ seat wave one grabbed, roughly every 1.5 seconds, for up to 15 seconds — straddling the 10-second TTL window.
3. Every attempt is logged with its status and elapsed time, so the exact moment each seat flips from `409 Conflict` → `200 OK` can be checked against the TTL.

### Empirical Results (The Proof Data)

Run 2026-09-08, from WSL2, with `LOCK_TTL_SECONDS=10`:

```
✗ wave1 initial lock succeeded (200)
  ↳  96% — ✓ 96 / ✗ 4
✓ wave2 response is 200 (won) or 409 (still locked)

checks..........................: 99.63% 1096 out of 1100
data_received....................: 431 kB 11 kB/s
data_sent.........................: 513 kB 13 kB/s
http_req_blocked...................: avg=3.27ms   min=2.17µs       med=4.66µs   max=1.01s   p(90)=739.85µs p(95)=1.85ms
http_req_connecting.................: avg=3.24ms   min=0s           med=0s       max=1.01s   p(90)=625.39µs p(95)=1.56ms
http_req_duration....................: avg=189.22ms min=-434004772ns med=12.23ms  max=1.6s    p(90)=748.87ms p(95)=1.38s
    { expected_response:true }......: avg=404.08ms min=-434004772ns med=107.86ms max=1.6s    p(90)=1.46s    p(95)=1.52s
http_req_failed.......................: 69.46% 903 out of 1300
http_req_receiving.....................: avg=6.94ms   min=-497794793ns med=329.66µs max=49.01ms p(90)=42.35ms  p(95)=43.89ms
http_req_sending........................: avg=52.66µs  min=5.17µs       med=17.16µs  max=1.79ms  p(90)=69.9µs   p(95)=161.96µs
http_req_tls_handshaking.................: avg=0s       min=0s           med=0s       max=0s      p(90)=0s       p(95)=0s
http_req_waiting..........................: avg=182.23ms min=0s           med=11.99ms  max=1.6s    p(90)=746.33ms p(95)=1.37s
http_reqs...................................: 1300   33.865576/s
iteration_duration...........................: avg=1.75s min=1.5s med=1.51s max=3.62s p(90)=2.31s p(95)=3.4s
iterations.....................................: 1100   28.655488/s
vus.............................................: 14     min=0   max=200
vus_max...........................................: 200    min=200 max=200
wave1_lock_failures_total...........................: 4      0.104202/s
wave2_conflict_total.................................: 899    23.419349/s
✗ wave2_success_total................................: 101    2.631095/s

THRESHOLDS
wave2_success_total
✗ 'count<=100' count=101
```

**Verdict: the threshold failed — 101 wins against a 100-seat pool. Root-caused, and it isn't a data-integrity bug.**

Investigated by cross-referencing the run's own console log rather than accepting the anomaly at face value:

- **Two wave-two VU numbers, each exactly 100 apart, targeted the same seat.** Seats 590, 592, and 601 were each attempted by two different `__VU` values: `89` & `189`, `91` & `191`, and `100` & `200`. The script computes `index = (__VU - 1) % data.wave2Tokens.length` (length 100) — both members of each pair alias to the same index (`88`, `90`, `99`), so both physical k6 execution threads ended up driving the _same_ logical test account against the _same_ seat.
- **Wave one shows the same aliasing from the other side.** Its own failure log names VUs `101`, `102`, and `103` — numbers that should be structurally impossible in a scenario declared with `vus: 100`, if that scenario had an exclusive 1–100 range. It doesn't: `wave_one_initial_lock` (start `0s`) and `wave_two_retry_after_ttl` (start `1s`) overlap for most of the run, and k6 draws both scenarios' virtual users from one shared pool (`vus_max: 200`) rather than two disjoint 1–100 / 101–200 ranges.
- **One win came suspiciously early — seat 601 at `t=1.8s`, far before any 10-second TTL could have expired.** Consistent with the same mechanism: whichever aliased VU actually reached wave one's exec function for that index likely never won the seat in the first place, leaving it free for wave two to take almost immediately, rather than after a genuine TTL expiry.

All three observations point at one root cause: because the two scenarios' active windows overlap, `(__VU - 1) % 100` is not a safe way to derive "which of the 100 logical seats does this request belong to" — k6 doesn't guarantee VU-number partitioning across concurrently-running scenarios. The result was extra, uncounted-for attempts on 3 of the 100 seats, not a real ability to lock a seat twice at once.

**What this does and doesn't prove.** Nothing about Redis's atomicity or the TTL mechanism itself failed: every "extra" win was sequential — the seat was genuinely free (its lock had expired or was never taken) at the moment each one landed, never two simultaneous holders. Confirmed directly against the running system after the test: `redis-cli --scan --pattern 'seat_lock:3:*'` returned zero keys, and every one of the 100 seats read back `AVAILABLE` in Postgres. The 4 wave-one failures are the same story: VU `103`'s `409 Seat is currently locked by another user` on seat `504` means an aliased sibling VU had already won that seat moments earlier in the same wave.

**A fix worth naming for whoever next edits this script:** don't derive the seat index from a raw `__VU` number when two `per-vu-iterations` scenarios can be active at the same time. Either stagger the two scenarios so their windows never overlap, or tag each iteration with something scenario-scoped (`exec.scenario.iterationInInstance`) instead of the shared, cross-scenario `__VU` counter.

---

## 5. Event Page Spike Test

### Test Objectives & Setup

Proves that a sudden, unthrottled spike of anonymous traffic on **read-heavy discovery endpoints** — the pages people refresh right before a sale goes live — doesn't break the server's connection to Postgres or take the service down.

- **Script:** `spikeTest.js`
- **Executor:** `ramping-vus`
- **Load profile:** baseline 50 VUs → spike to 2,000 VUs over 10s → hold at 2,000 for 20s → drop back to 50 VUs
- **Endpoints under test:** `GET /api/events` (listing) and `GET /api/events/:id` (detail), mixed randomly per request — no authentication, matching real anonymous browsing traffic

### k6 Script Logic

Each VU, on every iteration, randomly chooses between the listing endpoint and a random event's detail endpoint. Any `5xx` response is tracked in a dedicated counter, since that's the specific failure signature of an exhausted Postgres connection pool, distinct from ordinary request failures.

### Empirical Results (The Proof Data)

Run 2026-09-08, from WSL2:

```
✗ request did not fail with a server error
  ↳  99% — ✓ 40860 / ✗ 10

checks.........................: 99.97% 40860 out of 40870
data_received....................: 36 MB  367 kB/s
data_sent.........................: 4.2 MB 42 kB/s
✓ db_error_responses_total........: 10     0.101688/s
http_req_blocked....................: avg=70.04ms min=1.12µs       med=3.56µs   max=11.4s    p(90)=6.36µs  p(95)=53.22µs
http_req_connecting.................: avg=70.02ms min=0s           med=0s       max=11.4s    p(90)=0s      p(95)=0s
✗ http_req_duration..................: avg=1.58s   min=-493937535ns med=123.63ms max=31.47s   p(90)=5.02s   p(95)=9.29s
    { expected_response:true }......: avg=1.57s   min=-493937535ns med=123.62ms max=31.09s   p(90)=5.02s   p(95)=9.28s
✓ http_req_failed.....................: 0.02%  10 out of 40870
http_req_receiving.....................: avg=40.94ms min=-549472926ns med=42.95ms max=343.19ms p(90)=46.86ms p(95)=47.58ms
http_req_sending........................: avg=19.78µs min=4.18µs       med=13.09µs max=597.59µs p(90)=37.27µs p(95)=48.34µs
http_req_tls_handshaking.................: avg=0s      min=0s           med=0s      max=0s       p(90)=0s      p(95)=0s
http_req_waiting..........................: avg=1.53s   min=0s           med=78.39ms  max=31.47s   p(90)=4.98s   p(95)=9.24s
http_reqs...................................: 40870  415.597736/s
iteration_duration...........................: avg=1.67s   min=79.94ms      med=123.82ms max=34.73s   p(90)=5.1s    p(95)=9.79s
iterations.....................................: 40870  415.597736/s
vus.............................................: 50     min=50   max=2000
vus_max...........................................: 2000   min=2000 max=2000

running (1m38.3s), 0000/2000 VUs, 40870 complete and 2 interrupted iterations
read_heavy_spike ✓ [ 100% ] 0000/2000 VUs  1m40s
```

**Verdict: 2 of 3 thresholds passed. The one that failed exposes the same DB-pool ceiling found in Section 2, this time from a purely read-only path.**

- **`db_error_responses_total = 10`**, well under the `<50` bar — passed. **`http_req_failed = 0.02%`** (10 out of 40,870), well under the `<8%` bar — passed. Correctness and availability held: 99.98% of 40,870 requests, at a 2,000-VU peak, succeeded cleanly.
- **`http_req_duration p(95) = 9.29s` — failed the `<1500ms` bar by more than 6x.** The 10 failures were counted two independent ways that agree exactly: k6's own per-request error log and the API's access log both show precisely 8 on `GET /api/events` and 2 on `GET /api/events/:id`. Every one traces to the identical root cause as Section 2:

  ```
  sqlalchemy.exc.TimeoutError: QueuePool limit of size 20 overflow 20 reached,
  connection timed out, timeout 30.00
  ```

  This is the same 40-connection pool ceiling, now reached by an entirely different, purely read-only code path — confirming the limit is a whole-API characteristic (anything that resolves the current user or reads the database competes for the same 40 connections), not something specific to the payment or locking flow. Most requests queued for a connection rather than failing outright, which is why the median latency stayed low (`123.63ms`) while the tail exploded — a handful of unlucky requests waited the full 30-second pool timeout before either succeeding late or failing.
- **A measurement artifact, not a bug:** the negative minimum durations (`min=-493937535ns`, etc.) are the same WSL2/Windows clock-offset artifact documented in Section 2.

---

## Summary of Findings

| Test                 | What Was Proven                                                                                                                                                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atomic Lock Race      | The Redis atomic lock guarantees exactly one winner per seat no matter, with zero double-booking / overselling, even under its maximum. 500/500 clean, cross-checked against the API's own log.                                                                                                                                                            |
| Flash Sale E2E Flow   | All 500 seats sold, all 500 bookings `CONFIRMED`, zero overselling, under a genuine 2,000-user rush, cross-checked directly against Postgres. Found and root-caused one real capacity limit: the API's 40-connection DB pool saturates somewhere between 500 and 2,000 concurrent users, producing a precisely-counted 117 `500` responses out of 83,411 requests — a capacity ceiling, not a data-integrity issue. |
| Auth Load Baseline   | `/api/auth/login` under 8 sustained VUs: 100% success, p(95) = 63.08ms against a 500ms bar — no concerns at this scale. |
| Seat Expiry (TTL) Leak Test | Abandoned locks self-clean via Redis TTL alone — no manual cleanup job, and zero locks or inconsistent seats left behind afterward. One threshold nominally failed (101 wins against a 100-seat pool); root-caused to a k6 test-harness artifact (VU-number aliasing across two overlapping scenarios), not an application bug — see Section 4 for the full evidence trail. Also found and fixed a real bug in the script itself (`SEAT_COUNT` was `601`, should have been `100`). |
| Event Page Spike Test | Read-heavy browsing endpoints survived a 40x anonymous traffic spike (2,000 VUs) with correctness intact — 99.98% success, only 10 real 5xx responses. Latency did not: p(95) hit 9.29s against a 1500ms bar, tracing to the same DB connection-pool ceiling found in Section 2, this time on a purely read-only path. |

**Overall conclusion:** across every load profile tested, the core correctness guarantee held without exception — no seat was ever oversold or double-booked, whether under a single-seat 500-way race, a genuine 2,000-user flash sale for 500 seats, or sustained TTL-expiry retry pressure. The one real weakness surfaced by this testing is a database connection-pool ceiling — `app/db.py`'s pool (`pool_size=20, max_overflow=20`, 40 total) saturates somewhere between 500 and 2,000 concurrent requests, hit independently by three different code paths (locking, checkout, and plain reads) and producing `500` responses or multi-second tail latency rather than corrupting state under overload. Documented above with the exact traceback each time, rather than hidden or excluded from this report. A second, narrower finding: `seatAbandonTest.js`'s own seat-indexing scheme isn't safe when its two scenarios overlap in time — a test-script fix, not an application one, and named precisely in Section 4.

## Get Started with Tests

Every test above was run the same way: the ordinary dev stack from [`server/README.md`](../README.md) (Postgres + Redis via `docker compose up -d`, the API, and the payment worker) with k6 run separately — no Prometheus, no Grafana.

### Prerequisites

- **Python 3.13** with **uv** (to run the API and worker)
- **Docker & Docker Compose** (for Postgres and Redis)
- **k6**, run from **WSL2** (or any Linux environment) rather than native Windows. Firing hundreds of near-simultaneous connections at `localhost` from native Windows drops a large fraction of them at the TCP layer before they reach the server — see the methodology note in Section 1. From WSL2, reach the Windows-hosted API via `http://host.docker.internal:5000`.

### 1. Bring up the stack

Follow the Quick Start in [`server/README.md`](../README.md) — `docker compose up -d`, `alembic upgrade head`, seed, then run the API and the worker in two terminals. **Both are required**; without the worker, every booking stays `PENDING` forever.

### 2. Generate dummy users

`seatLockTest.js`, `flashSaleTest.js`, and `seatAbandonTest.js` all read or create their own pre-signed tokens rather than logging in thousands of virtual users during the test itself:

```bash
# seatLockTest.js needs >=500 users; flashSaleTest.js needs >=2000 (VU_COUNT in the script)
uv run python -m app.scripts.generate_dummy_users --count 2500
```

This writes `loadtests/users.json`, read via `SharedArray`. Every generated user shares the password `LoadTest123!` — that's also what `loginTest.js`'s 8 fixed accounts (`loadtest1@test.com`..`loadtest8@test.com`) need to be registered with, via `POST /api/auth/register`, before running it. `seatAbandonTest.js` self-registers its own 200 accounts in `setup()` and needs no pre-generated file.

### 3. Run a test

Each script hardcodes `BASE_URL`. From WSL2, retarget that to reach the Windows host — either edit the constant directly, or run against a copy with it substituted:

```bash
sed 's#http://localhost:5000/api#http://host.docker.internal:5000/api#' \
  scripts/seatLockTest.js > /tmp/seatLockTest.js
k6 run /tmp/seatLockTest.js
```

(`loginTest.js` hardcodes `.../api/auth` specifically — substitute that exact prefix instead.)

Match each script's own config against a real seeded event before running:

| Script | Needs |
| --- | --- |
| `seatLockTest.js` | `EVENT_ID=1, SEAT_ID=1` |
| `flashSaleTest.js` | `EVENT_ID=2`, seats `2..501` (500 total), `PAYMENT_PROVIDER=mock` on the API |
| `loginTest.js` | the 8 `loadtest*@test.com` accounts registered (see above) |
| `seatAbandonTest.js` | `EVENT_ID=3`, seats `502..601` (100 total, `SEAT_COUNT=100`), and `LOCK_TTL_SECONDS` in `app/constants.py` temporarily set to `10` (revert to `300` and restart the API afterward — don't leave the dev server running with a 10-second lock TTL) |
| `spikeTest.js` | no setup — anonymous, targets `EVENT_ID` `1..3` |
