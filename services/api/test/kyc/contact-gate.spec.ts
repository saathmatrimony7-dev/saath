/**
 * Contact gate tests (P2-02) — P2 exit criterion 1: "unverified users cannot
 * message". Messaging lands in P4; today the gate is enforced by
 * KycService.assertCanContact (the precondition the message path must call)
 * and reported by GET /v1/me/verification.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { bootTestApp, signupTestUser, TestClient, type TestApp } from '../helpers/test-app';
import { KycService } from '../../src/modules/kyc/kyc.service';

const SECRET = 'test-kyc-webhook-secret-0123456789';

let t: TestApp;
let hook: TestClient;

function sign(body: unknown): string {
  return `sha256=${createHmac('sha256', SECRET).update(JSON.stringify(body)).digest('hex')}`;
}

async function verifyThroughKyc(c: TestClient, eventPrefix: string): Promise<void> {
  await c.put('/v1/me/consents/kyc', { granted: true, channel: 'app' }, c.csrfHeaders());
  const started = await c.post('/v1/me/kyc', { type: 'id_liveness' }, c.csrfHeaders());
  expect(started.status).toBe(201);
  const providerRef = (started.json as { providerRef: string }).providerRef;
  const body = {
    event_id: eventPrefix,
    provider_ref: providerRef,
    result: 'pass',
    age: 29,
    name_match: true,
    masked_id: 'XXXXXXXX9012',
  };
  const res = await hook.post('/v1/hooks/kyc', body, { 'x-hub-signature-256': sign(body) });
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  t = await bootTestApp();
  hook = new TestClient(t.baseUrl);
});

afterAll(async () => {
  await t.app.close();
});

describe('contact gate (unverified users cannot message)', () => {
  it('fresh user: canContact=false with verification_required + age_unverified', async () => {
    const { client } = await signupTestUser(t, '+919876500301');
    const anon = new TestClient(t.baseUrl);
    expect((await anon.get('/v1/me/verification')).status).toBe(401);
    const res = await client.get('/v1/me/verification');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      status: 'active',
      tier: 0,
      ageVerified: false,
      canContact: false,
      reasons: expect.arrayContaining(['verification_required', 'age_unverified']),
    });
  });

  it('verified user (tier 2 + age): canContact=true, no reasons', async () => {
    const { client } = await signupTestUser(t, '+919876500302');
    await verifyThroughKyc(client, 'evt.gate-1');
    const res = await client.get('/v1/me/verification');
    expect(res.json).toEqual({
      status: 'active',
      tier: 2,
      ageVerified: true,
      canContact: true,
      reasons: [],
    });
  });

  it('blocked user: canContact=false with account_blocked', async () => {
    const { client } = await signupTestUser(t, '+919876500303');
    // Block via an underage KYC result (hard signal).
    await client.put(
      '/v1/me/consents/kyc',
      { granted: true, channel: 'app' },
      client.csrfHeaders(),
    );
    const started = await client.post('/v1/me/kyc', { type: 'id' }, client.csrfHeaders());
    const providerRef = (started.json as { providerRef: string }).providerRef;
    const body = { event_id: 'evt.gate-block', provider_ref: providerRef, result: 'pass', age: 15 };
    await hook.post('/v1/hooks/kyc', body, { 'x-hub-signature-256': sign(body) });

    const res = await client.get('/v1/me/verification');
    expect((res.json as { canContact: boolean }).canContact).toBe(false);
    expect((res.json as { reasons: string[] }).reasons).toContain('account_blocked');
  });

  it('assertCanContact is importable by the future messaging module (service export)', async () => {
    // Compile-time guarantee lives in typecheck; here we assert the module
    // exports the service by resolving it from the Nest container.
    const service = t.app.get(KycService);
    expect(typeof service.assertCanContact).toBe('function');
    await expect(service.assertCanContact(crypto.randomUUID())).rejects.toThrow();
  });
});
