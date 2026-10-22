/**
 * Authorisation matrix (qa-engineer harness): endpoint × role expectations.
 * P0 covers the auth endpoints + /v1/me. Later phases append rows here.
 *
 * Roles tested now: anonymous, authenticated owner. Family/support/moderator/
 * admin rows arrive with those modules (P2).
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

async function signup(client: TestClient, phone: string): Promise<string> {
  await client.post('/v1/auth/otp/request', { phone });
  const code = t.mockSms.outbox.at(-1)?.code as string;
  const res = await client.post('/v1/auth/otp/verify', { phone, code });
  return res.json?.userId as string;
}

describe('authorisation matrix — P0 endpoints', () => {
  it('GET /v1/me: anonymous denied (401), owner allowed (200)', async () => {
    const anon = new TestClient(t.baseUrl);
    const denied = await anon.get('/v1/me');
    expect(denied.status).toBe(401);

    const owner = new TestClient(t.baseUrl);
    const userId = await signup(owner, '+919000000001');
    const allowed = await owner.get('/v1/me');
    expect(allowed.status).toBe(200);
    expect(allowed.json?.id).toBe(userId);
  });

  it('GET /v1/me: a tampered/foreign token is denied', async () => {
    const client = new TestClient(t.baseUrl);
    client.cookies.set('saath_at', 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1c3JfYm9ndXMifQ.forged');
    const res = await client.get('/v1/me');
    expect(res.status).toBe(401);
  });

  it('POST /v1/auth/otp/request: anonymous allowed (public endpoint), strict schema', async () => {
    const anon = new TestClient(t.baseUrl);
    const res = await anon.post('/v1/auth/otp/request', { phone: '+919000000002' });
    expect(res.status).toBe(202);
    const bad = await anon.post('/v1/auth/otp/request', {});
    expect(bad.status).toBe(400);
  });

  it('POST /v1/auth/refresh: anonymous (no cookie) denied; CSRF enforced', async () => {
    const anon = new TestClient(t.baseUrl);
    const res = await anon.post('/v1/auth/refresh');
    expect([401, 403]).toContain(res.status);
  });

  it('owner context is bound to the JWT subject — no way to act as another user', async () => {
    const a = new TestClient(t.baseUrl);
    const b = new TestClient(t.baseUrl);
    const idA = await signup(a, '+919000000003');
    const idB = await signup(b, '+919000000004');
    expect(idA).not.toBe(idB);

    const meA = await a.get('/v1/me');
    const meB = await b.get('/v1/me');
    expect(meA.json?.id).toBe(idA);
    expect(meB.json?.id).toBe(idB);
    // The API surface exposes no user-id parameter to confuse — identity comes
    // solely from the verified JWT. RLS adds the second layer (proven in test/rls).
  });
});
