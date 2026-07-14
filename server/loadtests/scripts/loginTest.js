import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 8,
  duration: "2m",
  thresholds: {
    http_req_duration: ["p(95)<500"],
    checks: ["rate>0.95"],
  },
};
/* 95% of requests should complete under 500ms */
/* 95%+ of checks should pass */

const BASE_URL = "http://localhost:5000/api/auth";

// per-user/per-IP rate limiter and gives more realistic results.

/* These are the dummy users you must have in your db Before trying to run this script */
// Over here i would just try to login them and see if it works and note their report
/* Spreading users would avoid tripping */
const users = [
  { email: "loadtest1@test.com", password: "LoadTest123!" },
  { email: "loadtest2@test.com", password: "LoadTest123!" },
  { email: "loadtest3@test.com", password: "LoadTest123!" },
  { email: "loadtest4@test.com", password: "LoadTest123!" },
  { email: "loadtest5@test.com", password: "LoadTest123!" },
  { email: "loadtest6@test.com", password: "LoadTest123!" },
  { email: "loadtest7@test.com", password: "LoadTest123!" },
  { email: "loadtest8@test.com", password: "LoadTest123!" },
];

export default function () {
  // __VU is k6's 1-indexed virtual user id would keep each VU on a stable account
  const user = users[(__VU - 1) % users.length];

  const payload = JSON.stringify({
    email: user.email,
    password: user.password,
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
    },
  };

  const res = http.post(`${BASE_URL}/login`, payload, params);

  check(res, {
    "login successful": (r) => r.status === 200,
    "token exists": (r) => {
      try {
        return r.status === 200 && JSON.parse(r.body).token !== undefined;
      } catch {
        return false;
      }
    },
  });

  // Small kind of delay so VU dont hit every second
  sleep(Math.random() * 1 + 0.5);
}
