import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

/*
  Spike test for read-heavy / browse routes (GET /api/events, GET /api/events/:id).

  Goal: prove that a sudden spike of concurrent readers doesn't break connections to Postgres or take down the server - i.e. connection pooling / caching absorbs the burst instead of every request hitting the DB directly.

  These are public browsing routes, so unlike the seat-lock/flash-sale scripts there is NO login/setup() here - anonymous traffic is exactly what a real page-refresh spike would look like.
*/

// ---------CONFIG------------ --> Please change the config data to match your own data and what data u want to aim
const BASE_URL = "http://localhost:5000/api";
const EVENT_ID_START = 1;
const EVENT_ID_END = 3;

const dbErrorCount = new Counter("db_error_responses_total");
// 5xx specifically
const unexpectedStatusCount = new Counter("unexpected_status_total");

export const options = {
  scenarios: {
    read_heavy_spike: {
      executor: "ramping-vus",
      startVUs: 50,
      stages: [
        { duration: "30s", target: 50 },
        // Baseline - establish steady state
        { duration: "10s", target: 2000 },
        // SPIKE - the clock-strikes-12 refresh storm
        { duration: "20s", target: 2000 },
        { duration: "10s", target: 50 },
        { duration: "30s", target: 50 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    // The core claim under test: connections to Postgres should not break Or exhaust under the spike. A 5xx spike here (connection pool
    // Exhaustion, timeouts, crashes) is the failure signature we're Watching for. Some tolerance is kept since a handful of transient Errors during a true spike is realistic; a large spike is not.
    db_error_responses_total: ["count<50"],
    http_req_failed: ["rate<0.08"],
    http_req_duration: ["p(95)<1500"],
  },
};

export default function () {
  //  We are simulating here a random user behaviour of click an Event or Click all Events - random behaviour
  const hitDetailPage = Math.random() < 0.5;

  let res;
  if (hitDetailPage) {
    const eventId =
      EVENT_ID_START +
      Math.floor(Math.random() * (EVENT_ID_END - EVENT_ID_START + 1));
    res = http.get(`${BASE_URL}/events/${eventId}`, {
      tags: { endpoint: "event_detail" },
    });
  } else {
    res = http.get(`${BASE_URL}/events`, {
      tags: { endpoint: "event_list" },
    });
  }

  if (res.status >= 500) {
    dbErrorCount.add(1);
    console.error(
      `${hitDetailPage ? "detail" : "list"} request failed with ${res.status}: ${res.body}`,
    );
  } else if (res.status !== 200) {
    unexpectedStatusCount.add(1);
  }

  check(res, {
    "request did not fail with a server error": (r) => r.status < 500,
  });
}
