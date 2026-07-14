import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

/*
  Seat-lock ABANDONMENT / TTL-expiry test.

  Goal: prove that when a user locks a seat and then abandons it (never
  calls /pay), the Redis lock actually expires on schedule and the seat
  becomes lockable again - i.e. your cleanup relies on TTL expiry alone
  and doesn't leak/stall under concurrent retry pressure.

  For convenience we run the test with 10s TTL
  BEFORE RUNNING: temporarily drop your LOCK_SEAT_TTL config to 10 seconds
  inside out constants.ts
*/

const BASE_URL = "http://localhost:5000/api";

// ---------CONFIG------------ --> Please change the config data to match your own data and what data u want to aim
// These must match a seeded event in your DB with >= 100 seats ----
const EVENT_ID = 3;
const SEAT_ID_START = 502;
const SEAT_COUNT = 100;

// ---------CONFIG------------ --> Please change the config data to match your own data and what data u want to aim
// This must match lock TTL to ----
const LOCK_TTL_SECONDS = 10;
const PASSWORD = "12345";


const wave2ConflictCount = new Counter("wave2_conflict_total");
const wave2SuccessCount = new Counter("wave2_success_total");
const wave2UnexpectedCount = new Counter("wave2_unexpected_total");
const wave1LockFailures = new Counter("wave1_lock_failures_total");

export const options = {
  setupTimeout: "3m",
  // Registering 200 users sequentially will take a while
  scenarios: {
    wave_one_initial_lock: {
      executor: "per-vu-iterations",
      exec: "wave1Lock",
      vus: SEAT_COUNT,
      iterations: 1,
      startTime: "0s",
      maxDuration: "20s",
    },
    wave_two_retry_after_ttl: {
      executor: "per-vu-iterations",
      exec: "wave2Retry",
      vus: SEAT_COUNT,
      iterations: 10,
      // Spaced ~1.5s apart -> covers ~15s, well past a 10s TTL
      startTime: "1s",
      // Start just after wave one has had time to lock in
      maxDuration: "30s",
    },
  },
  thresholds: {
    // Sanity: only 100 seats exist, so wave two can never "win" more than 100.
    wave2_success_total: ["count<=100"],
  },
};

// setup() registers 200 distinct users once, before either scenario starts: the first 100 become "wave one" (the abandoners), the next 100 become "wave two" (the retriers). Index i is shared between both waves and maps to the same seatId, so wave1 user i and wave2 user i are always fighting over the exact same seat.
export function setup() {
  const timestamp = Date.now();
  const wave1Tokens = [];
  const wave2Tokens = [];

  const registerUser = (email) => {
    const res = http.post(
      `${BASE_URL}/auth/register`,
      JSON.stringify({ name: email, email, password: PASSWORD }),
      { headers: { "Content-Type": "application/json" } },
    );
    if (res.status !== 201) {
      throw new Error(
        `Setup registration failed for ${email}: ${res.status} ${res.body}`,
      );
    }
    return JSON.parse(res.body).token;
  };

  for (let i = 0; i < SEAT_COUNT; i++) {
    wave1Tokens.push(
      registerUser(`ttl_wave1_TRY2${timestamp}_${i}@example.com`),
    );
    wave2Tokens.push(
      registerUser(`ttl_wave2_TRY2${timestamp}_${i}@example.com`),
    );
  }

  // Recorded so every VU can compute elapsed time relative to the same reference point, useful 
  const testStart = Date.now();

  return { wave1Tokens, wave2Tokens, testStart };
}

// Wave one: lock a seat, then deliberately do nothing else. Never calls /pay. This is the "abandoned lock" - its only fate is to expire via TTL.
export function wave1Lock(data) {
  const index = (__VU - 1) % data.wave1Tokens.length;
  const token = data.wave1Tokens[index];
  const seatId = SEAT_ID_START + index;

  if (!token) {
    console.error(`Wave1 VU ${__VU} has no token for index ${index}`);
    return;
  }

  const lockRes = http.post(
    `${BASE_URL}/seats/${EVENT_ID}/${seatId}/lock`,
    null,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  const gotLock = check(lockRes, {
    "wave1 initial lock succeeded (200)": (r) => r.status === 200,
  });

  if (!gotLock) {
    wave1LockFailures.add(1);
    console.error(
      `Wave1 VU ${__VU} failed to acquire seat ${seatId}: ${lockRes.status} ${lockRes.body}`,
    );
  }

  // Idle/abandon - no /pay call, no relock, no TTL refresh. Just stop.
  sleep(2);
}

// Wave two: repeatedly attempts to lock the SAME seat wave1 grabbed. Expect 409 while the lock is still held, then 200 once the TTL expires.
export function wave2Retry(data) {
  const index = (__VU - 1) % data.wave2Tokens.length;
  const token = data.wave2Tokens[index];
  const seatId = SEAT_ID_START + index;

  if (!token) {
    console.error(`Wave2 VU ${__VU} has no token for index ${index}`);
    return;
  }

  const lockRes = http.post(
    `${BASE_URL}/seats/${EVENT_ID}/${seatId}/lock`,
    null,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  const elapsedSec = ((Date.now() - data.testStart) / 1000).toFixed(1);

  if (lockRes.status === 200) {
    wave2SuccessCount.add(1);
    console.log(
      `Wave2 VU ${__VU} WON seat ${seatId} at t=${elapsedSec}s (TTL=${LOCK_TTL_SECONDS}s)`,
    );
  } else if (lockRes.status === 409) {
    wave2ConflictCount.add(1);
    console.log(
      `Wave2 VU ${__VU} conflict on seat ${seatId} at t=${elapsedSec}s`,
    );
  } else {
    wave2UnexpectedCount.add(1);
    console.error(
      `Wave2 VU ${__VU} unexpected status ${lockRes.status} on seat ${seatId} at t=${elapsedSec}s: ${lockRes.body}`,
    );
  }

  check(lockRes, {
    "wave2 response is 200 (won) or 409 (still locked)": (r) =>
      r.status === 200 || r.status === 409,
  });

  sleep(1.5);
  // Spacing between retry attempts
}

export function defaultFn(data) {
  return wave2Retry(data);
}
