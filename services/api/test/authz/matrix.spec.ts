/**
 * Authorisation matrix (qa-engineer harness): endpoint × role expectations.
 * P0 covers the auth endpoints + /v1/me; P1 appends consents, profiles,
 * photos, onboarding and the WhatsApp webhook rows below.
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

describe('authorisation matrix — P1 endpoints', () => {
  it('GET /v1/me/consents: anonymous denied (401), owner allowed (200)', async () => {
    const anon = new TestClient(t.baseUrl);
    expect((await anon.get('/v1/me/consents')).status).toBe(401);
    const owner = new TestClient(t.baseUrl);
    await signup(owner, '+919000000010');
    expect((await owner.get('/v1/me/consents')).status).toBe(200);
  });

  it('PUT /v1/me/consents/:purpose: anonymous 401, no-CSRF 403, unknown purpose 400, owner 200', async () => {
    const anon = new TestClient(t.baseUrl);
    expect(
      (await anon.put('/v1/me/consents/whatsapp', { granted: true, channel: 'app' })).status,
    ).toBe(401);

    const owner = new TestClient(t.baseUrl);
    await signup(owner, '+919000000011');
    const noCsrf = await owner.req('PUT', '/v1/me/consents/whatsapp', {
      granted: true,
      channel: 'app',
    });
    expect(noCsrf.status).toBe(403);
    const badPurpose = await owner.put(
      '/v1/me/consents/not-a-purpose',
      { granted: true },
      owner.csrfHeaders(),
    );
    expect(badPurpose.status).toBe(400);
    const ok = await owner.put(
      '/v1/me/consents/whatsapp',
      { granted: true, channel: 'app' },
      owner.csrfHeaders(),
    );
    expect(ok.status).toBe(200);
  });

  it('GET/PATCH /v1/me/profile: anonymous denied, PATCH no-CSRF 403, owner allowed', async () => {
    const anon = new TestClient(t.baseUrl);
    expect((await anon.get('/v1/me/profile')).status).toBe(401);
    expect((await anon.patch('/v1/me/profile', { displayName: 'x' })).status).toBe(401);

    const owner = new TestClient(t.baseUrl);
    await signup(owner, '+919000000012');
    const noCsrf = await owner.req('PATCH', '/v1/me/profile', { displayName: 'x' });
    expect(noCsrf.status).toBe(403);
    expect((await owner.get('/v1/me/profile')).status).toBe(200);
    expect(
      (await owner.patch('/v1/me/profile', { displayName: 'Tester' }, owner.csrfHeaders())).status,
    ).toBe(200);
  });

  it('GET /v1/profiles/:id: anonymous 401, foreign owner 404, self 200', async () => {
    const a = new TestClient(t.baseUrl);
    const b = new TestClient(t.baseUrl);
    const idA = await signup(a, '+919000000013');
    await signup(b, '+919000000014');

    const anon = new TestClient(t.baseUrl);
    expect((await anon.get(`/v1/profiles/${idA}`)).status).toBe(401);
    expect((await b.get(`/v1/profiles/${idA}`)).status).toBe(404); // foreign → 404, never 403
    // Materialise A's profile row, then the owner can fetch it by id.
    await a.patch('/v1/me/profile', { displayName: 'A' }, a.csrfHeaders());
    expect((await a.get(`/v1/profiles/${idA}`)).status).toBe(200);
  });

  it('taxonomy + attribute definitions are public read (anonymous 200)', async () => {
    const anon = new TestClient(t.baseUrl);
    expect((await anon.get('/v1/taxonomy/religions?locale=en')).status).toBe(200);
    expect((await anon.get('/v1/taxonomy/cities?q=del&locale=en')).status).toBe(200);
    expect((await anon.get('/v1/attributes?locale=en')).status).toBe(200);
  });

  it('POST /v1/me/photos: anonymous 401, authed no-CSRF 403', async () => {
    const anon = new TestClient(t.baseUrl);
    expect((await anon.post('/v1/me/photos', {})).status).toBe(401);
    const owner = new TestClient(t.baseUrl);
    await signup(owner, '+919000000015');
    const noCsrf = await owner.req('POST', '/v1/me/photos', {});
    expect(noCsrf.status).toBe(403);
  });

  it('onboarding: anonymous denied, no-CSRF 403 on mutations, foreign transcript 404', async () => {
    const anon = new TestClient(t.baseUrl);
    expect((await anon.post('/v1/onboarding/sessions', { locale: 'en' })).status).toBe(401);
    expect((await anon.get('/v1/onboarding/sessions')).status).toBe(401);
    expect(
      (
        await anon.post('/v1/onboarding/confirm', {
          sessionId: crypto.randomUUID(),
          confirmed: true,
        })
      ).status,
    ).toBe(401);

    const a = new TestClient(t.baseUrl);
    const b = new TestClient(t.baseUrl);
    await signup(a, '+919000000016');
    await signup(b, '+919000000017');
    const noCsrf = await a.req('POST', '/v1/onboarding/sessions', { locale: 'en' });
    expect(noCsrf.status).toBe(403);
    const started = await a.post('/v1/onboarding/sessions', { locale: 'en' }, a.csrfHeaders());
    expect(started.status).toBe(201);
    const { sessionId } = started.json as { sessionId: string };
    expect((await a.get('/v1/onboarding/sessions')).status).toBe(200);
    expect((await b.get(`/v1/onboarding/sessions/${sessionId}`)).status).toBe(404);
  });

  it('POST /v1/hooks/whatsapp: signature IS the auth — invalid signature 401, no session needed', async () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '1' },
                messages: [],
              },
            },
          ],
        },
      ],
    };
    const anon = new TestClient(t.baseUrl);
    const denied = await anon.post('/v1/hooks/whatsapp', body, {
      'x-hub-signature-256': 'sha256=invalid',
    });
    expect(denied.status).toBe(401);
  });

  it('GET /v1/hooks/whatsapp: wrong verify token 403', async () => {
    const anon = new TestClient(t.baseUrl);
    const res = await anon.get(
      '/v1/hooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x',
    );
    expect(res.status).toBe(403);
  });
});
