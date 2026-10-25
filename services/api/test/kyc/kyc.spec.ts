/**
 * KYC tests (P2-01):
 * - consent gate: no kyc consent → 403; granted → start 201
 * - webhook: bad/missing signature → 401; replayed event id → ignored
 * - pass → tier + ageVerified + birthYear on user and profile
 * - fail → no tier, status recorded
 * - underage (hard signal T10) → user blocked, further KYC refused
 * - employment tier requires tier 2 first (monotonic tiers)
 * - anon auth: 401s; authz covered in the matrix spec
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { bootTestApp, signupTestUser, TestClient, type TestApp } from '../helpers/test-app';

const SECRET = 'test-kyc-webhook-secret-0123456789';

let t: TestApp;
let client: TestClient;
let hook: TestClient;

function sign(body: unknown): string {
  return `sha256=${createHmac('sha256', SECRET).update(JSON.stringify(body)).digest('hex')}`;
}

function result(eventId: string, providerRef: string, fields: Record<string, unknown> = {}) {
  return { event_id: eventId, provider_ref: providerRef, ...fields };
}

async function postKycWebhook(body: unknown, signature?: string) {
  return hook.post('/v1/hooks/kyc', body, {
    'x-hub-signature-256': signature ?? sign(body),
  });
}

async function grantKycConsent(c: TestClient) {
  const res = await c.put(
    '/v1/me/consents/kyc',
    { granted: true, channel: 'app' },
    c.csrfHeaders(),
  );
  expect(res.status).toBe(200);
}

async function startCheck(c: TestClient, type: string) {
  return c.post('/v1/me/kyc', { type }, c.csrfHeaders());
}

async function deliverResult(
  eventId: string,
  providerRef: string,
  fields: Record<string, unknown> = {},
) {
  const res = await postKycWebhook(result(eventId, providerRef, fields));
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  t = await bootTestApp();
  hook = new TestClient(t.baseUrl);
  ({ client } = await signupTestUser(t, '+919876500201'));
});

afterAll(async () => {
  await t.app.close();
});

describe('kyc start consent gate', () => {
  it('rejects starting without kyc consent (403)', async () => {
    const res = await startCheck(client, 'id_liveness');
    expect(res.status).toBe(403);
  });

  it('rejects anonymous (401) and no-CSRF (403)', async () => {
    const anon = new TestClient(t.baseUrl);
    expect((await anon.post('/v1/me/kyc', { type: 'id' })).status).toBe(401);
    const noCsrf = await client.req('POST', '/v1/me/kyc', { type: 'id' });
    expect(noCsrf.status).toBe(403);
  });

  it('starts a pending check once consent is granted', async () => {
    await grantKycConsent(client);
    const res = await startCheck(client, 'id_liveness');
    expect(res.status).toBe(201);
    const body = res.json as { providerRef: string; status: string };
    expect(body.status).toBe('pending');
    expect(body.providerRef).toContain('id_liveness');

    // A second start while one is pending conflicts.
    expect((await startCheck(client, 'id')).status).toBe(409);
  });
});

describe('kyc webhook result processing', () => {
  it('rejects bad and missing signatures (401)', async () => {
    const body = result('evt.bad-sig', 'ref-nope', { result: 'pass' });
    expect((await postKycWebhook(body, 'sha256=deadbeef')).status).toBe(401);
    expect((await hook.post('/v1/hooks/kyc', body)).status).toBe(401);
  });

  it('ignores unknown provider refs (200, no-op)', async () => {
    const res = await postKycWebhook(
      result('evt.unknown-ref', 'ref-does-not-exist', { result: 'pass' }),
    );
    expect(res.status).toBe(200);
  });
});

describe('kyc full lifecycle (fresh user)', () => {
  const PHONE = '+919876500202';
  let c2: TestClient;
  let ref: string;

  it('id_liveness pass → tier 2, age verified', async () => {
    ({ client: c2 } = await signupTestUser(t, PHONE));
    await grantKycConsent(c2);
    const res = await startCheck(c2, 'id_liveness');
    expect(res.status).toBe(201);
    ref = (res.json as { providerRef: string }).providerRef;

    await deliverResult('evt.life-1', ref, {
      result: 'pass',
      age: 28,
      name_match: true,
      masked_id: 'XXXXXXXX9012',
      score: 92,
    });

    const kyc = await c2.get('/v1/me/kyc');
    expect((kyc.json as { status: string; tier: number }).status).toBe('pass');
    expect((kyc.json as { tier: number }).tier).toBe(2);

    const me = await c2.get('/v1/me');
    expect((me.json as { ageVerified: boolean }).ageVerified).toBe(true);
    expect((me.json as { birthYear: number }).birthYear).toBe(new Date().getFullYear() - 28);

    const profile = await c2.get('/v1/me/profile');
    expect(
      (profile.json as { profile: { verificationTier: number } }).profile.verificationTier,
    ).toBe(2);
  });

  it('replayed webhook event does not re-apply', async () => {
    const before = await c2.get('/v1/me/profile');
    await postKycWebhook(result('evt.life-1', ref, { result: 'pass', age: 28 }));
    const after = await c2.get('/v1/me/profile');
    expect(after.json).toEqual(before.json);
  });

  it('employment pass bumps to tier 3; a later fail never lowers the tier', async () => {
    const started = await startCheck(c2, 'employment');
    expect(started.status).toBe(201);
    const empRef = (started.json as { providerRef: string }).providerRef;
    await deliverResult('evt.emp-1', empRef, { result: 'pass', age: 28 });
    let profile = await c2.get('/v1/me/profile');
    expect(
      (profile.json as { profile: { verificationTier: number } }).profile.verificationTier,
    ).toBe(3);

    const failStart = await startCheck(c2, 'id');
    expect(failStart.status).toBe(201);
    await deliverResult('evt.fail-1', (failStart.json as { providerRef: string }).providerRef, {
      result: 'fail',
      failure_reason: 'document unreadable',
    });
    profile = await c2.get('/v1/me/profile');
    expect(
      (profile.json as { profile: { verificationTier: number } }).profile.verificationTier,
    ).toBe(3);
  });
});

describe('kyc hard signals', () => {
  it('underage result blocks the account immediately (T10)', async () => {
    const { client: c3 } = await signupTestUser(t, '+919876500203');
    await grantKycConsent(c3);
    const started = await startCheck(c3, 'id_liveness');
    expect(started.status).toBe(201);
    const ref3 = (started.json as { providerRef: string }).providerRef;

    await deliverResult('evt.minor-1', ref3, { result: 'pass', age: 16, name_match: true });

    const me = await c3.get('/v1/me');
    expect((me.json as { status: string }).status).toBe('blocked');

    const kyc = await c3.get('/v1/me/kyc');
    expect((kyc.json as { status: string }).status).toBe('fail');

    // A blocked account cannot start new checks.
    expect((await startCheck(c3, 'id')).status).toBe(403);
  });

  it('employment check without tier 2 prerequisite does not grant tier 3', async () => {
    const { client: c4 } = await signupTestUser(t, '+919876500204');
    await grantKycConsent(c4);
    const started = await startCheck(c4, 'employment');
    expect(started.status).toBe(201);
    await deliverResult(
      'evt.emp-no-prereq',
      (started.json as { providerRef: string }).providerRef,
      {
        result: 'pass',
        age: 30,
      },
    );
    const kyc = await c4.get('/v1/me/kyc');
    expect((kyc.json as { tier: number }).tier).toBe(0);
  });
});
