/**
 * P5 load-test harness (DESIGN.md §19: "load test (k6)").
 *
 * Smoke profile against a LOCAL e2e server (pnpm --filter @saath/web e2e
 * boots the Core API with embedded PG + mock OTP/engine). It measures the
 * non-AI core endpoints the NFR applies to (§2.1: p95 < 300 ms on
 * non-AI endpoints): health, auth rejection path, webhook signature
 * rejection (constant-time HMAC work), taxonomy reads.
 *
 * Authenticated flows (signup → onboarding → matches) are NOT exercised
 * here: the mock OTP outbox lives in the API process, so a load driver
 * cannot complete OTP without a bridge. That extension, plus larger
 * VU/duration profiles, is scheduled with the staging environment (P5
 * infra); this harness is the committed, CI-runnable smoke.
 *
 *   k6 run scripts/k6/smoke.js
 */
import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3100';
const p95 = new Trend('endpoint_p95', true);

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    // §2.1: p95 < 300 ms on non-AI endpoints (smoke-scale assertion).
    endpoint_p95: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

const endpoints = [
  ['GET', '/v1/health'],
  ['GET', '/v1/me'], // 401 path: auth verification latency
  ['GET', '/v1/plans'], // 401 path (authenticated surface)
  ['POST', '/v1/hooks/razorpay'], // unsigned → 401 after HMAC verify
  ['GET', '/v1/taxonomy/religions'], // public reference read
];

export default function () {
  for (const [method, path] of endpoints) {
    const res =
      method === 'POST'
        ? http.post(`${BASE}${path}`, JSON.stringify({ event: 'payment.captured', payload: {} }), {
            headers: { 'content-type': 'application/json' },
          })
        : http.get(`${BASE}${path}`);
    p95.add(res.timings.duration);
    check(res, {
      [`${method} ${path} expected status`]: (r) => r.status === 200 || r.status === 401,
    });
  }
}
