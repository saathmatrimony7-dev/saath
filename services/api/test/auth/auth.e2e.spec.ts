/**
 * Auth flow e2e: OTP request/verify, rate limits, attempt caps, refresh
 * rotation with reuse detection, logout. Runs against embedded Postgres
 * with the app_login role (RLS enforced).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { bootTestApp, TestClient, type TestApp } from '../helpers/test-app';

let t: TestApp;
let app: INestApplication;

beforeAll(async () => {
  t = await bootTestApp();
  app = t.app;
});

afterAll(async () => {
  await app.close();
});

let phoneSeq = 1000000000;
const nextPhone = () => `+91${(phoneSeq++).toString()}`;

/** Completes a full signup/login; returns an authenticated client. */
async function signup(): Promise<{ client: TestClient; userId: string }> {
  const client = new TestClient(t.baseUrl);
  const phone = nextPhone();
  const req = await client.post('/v1/auth/otp/request', { phone });
  expect(req.status).toBe(202);
  const code = t.mockSms.outbox.at(-1)?.code;
  expect(code).toMatch(/^\d{6}$/);
  const res = await client.post('/v1/auth/otp/verify', { phone, code });
  expect(res.status).toBe(200);
  expect(res.json?.userId).toBeTruthy();
  expect(client.cookies.get('saath_at')).toBeTruthy();
  expect(client.cookies.get('saath_rt')).toBeTruthy();
  expect(client.cookies.get('saath_csrf')).toBeTruthy();
  return { client, userId: res.json?.userId as string };
}

describe('OTP request', () => {
  it('accepts a valid phone and sends a 6-digit code', async () => {
    const client = new TestClient(t.baseUrl);
    const phone = nextPhone();
    const res = await client.post('/v1/auth/otp/request', { phone });
    expect(res.status).toBe(202);
    expect(t.mockSms.outbox.at(-1)?.phoneE164).toBe(phone);
  });

  it('rejects unknown fields (strict validation)', async () => {
    const client = new TestClient(t.baseUrl);
    const res = await client.post('/v1/auth/otp/request', {
      phone: nextPhone(),
      isAdmin: true,
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid phone numbers', async () => {
    const client = new TestClient(t.baseUrl);
    const res = await client.post('/v1/auth/otp/request', { phone: '12345' });
    expect(res.status).toBe(400);
  });

  it('rate-limits after 5 requests/hour per phone', async () => {
    const client = new TestClient(t.baseUrl);
    const phone = nextPhone();
    for (let i = 0; i < 5; i++) {
      const res = await client.post('/v1/auth/otp/request', { phone });
      expect(res.status).toBe(202);
    }
    const sixth = await client.post('/v1/auth/otp/request', { phone });
    expect(sixth.status).toBe(429);
  });
});

describe('OTP verify', () => {
  it('rejects a wrong code and caps attempts at 3', async () => {
    const client = new TestClient(t.baseUrl);
    const phone = nextPhone();
    await client.post('/v1/auth/otp/request', { phone });
    const good = t.mockSms.outbox.at(-1)?.code as string;
    const wrong = good === '000000' ? '000001' : '000000';

    for (let i = 0; i < 3; i++) {
      const res = await client.post('/v1/auth/otp/verify', { phone, code: wrong });
      expect(res.status).toBe(401);
    }
    // Attempts exhausted: even the correct code now fails.
    const res = await client.post('/v1/auth/otp/verify', { phone, code: good });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid code format at the DTO level', async () => {
    const client = new TestClient(t.baseUrl);
    const res = await client.post('/v1/auth/otp/verify', {
      phone: nextPhone(),
      code: 'abcdef',
    });
    expect(res.status).toBe(400);
  });
});

describe('sessions', () => {
  it('full flow: signup → /v1/me → refresh → logout', async () => {
    const { client, userId } = await signup();

    const me = await client.get('/v1/me');
    expect(me.status).toBe(200);
    expect(me.json?.id).toBe(userId);

    const refreshed = await client.post('/v1/auth/refresh', undefined, client.csrfHeaders());
    expect(refreshed.status).toBe(200);

    const csrfBeforeLogout = client.cookies.get('saath_csrf') as string;
    const out = await client.post('/v1/auth/logout', undefined, client.csrfHeaders());
    expect(out.status).toBe(204);

    // After logout the cookies are gone: refresh is denied either at the CSRF
    // guard (403, cookie cleared) or at token validation (401). Both deny.
    const after = await client.post('/v1/auth/refresh', undefined, {
      'x-csrf-token': csrfBeforeLogout,
    });
    expect([401, 403]).toContain(after.status);
  });

  it('rotates the refresh token and revokes the session on reuse', async () => {
    const { client } = await signup();
    const originalRefresh = client.cookies.get('saath_rt') as string;

    // Legitimate rotation
    const ok = await client.post('/v1/auth/refresh', undefined, client.csrfHeaders());
    expect(ok.status).toBe(200);
    const rotatedRefresh = client.cookies.get('saath_rt') as string;
    expect(rotatedRefresh).not.toBe(originalRefresh);

    // Attacker replays the ORIGINAL (rotated-out) token → reuse detected,
    // session revoked for everyone.
    const attacker = new TestClient(t.baseUrl);
    attacker.cookies.set('saath_rt', originalRefresh);
    attacker.cookies.set('saath_csrf', client.cookies.get('saath_csrf') as string);
    const replay = await attacker.post('/v1/auth/refresh', undefined, attacker.csrfHeaders());
    expect(replay.status).toBe(401);

    // Even the legitimate user's rotated token is now dead (family revoked).
    const dead = await client.post('/v1/auth/refresh', undefined, client.csrfHeaders());
    expect(dead.status).toBe(401);
  });

  it('enforces CSRF double-submit on cookie-authed POSTs', async () => {
    const { client } = await signup();
    const noHeader = await client.post('/v1/auth/refresh');
    expect(noHeader.status).toBe(403);
    const wrongHeader = await client.post('/v1/auth/refresh', undefined, {
      'x-csrf-token': 'wrong',
    });
    expect(wrongHeader.status).toBe(403);
  });
});
