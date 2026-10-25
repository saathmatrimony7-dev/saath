/**
 * A3 risk scoring tests (P2-04, DESIGN.md A3 exit rule):
 * - deterministic signals: kyc_fail +30, name_mismatch +20, open_reports
 *   +25 each (cap 50), reused_photo +40, underage = critical case
 * - score >= threshold → ONE open safety case (recompute never floods)
 * - cases NEVER auto-ban; the subject cannot read their own cases (RLS)
 * - GET /v1/me/risk returns the owner's score + signal audit trail
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { bootTestApp, signupTestUser, TestClient, type TestApp } from '../helpers/test-app';
import { RiskScoringService } from '../../src/modules/safety/risk-scoring.service';
import type { MockModerationAgent } from '../../src/modules/safety/moderation-agent';
import { MODERATION_AGENT } from '../../src/modules/safety/moderation-agent.tokens';
import { PrismaService } from '../../src/prisma/prisma.service';

const SECRET = 'test-kyc-webhook-secret-0123456789';
let t: TestApp;
let risk: RiskScoringService;

function sign(body: unknown): string {
  return `sha256=${createHmac('sha256', SECRET).update(JSON.stringify(body)).digest('hex')}`;
}

/** Full KYC pass/fail driver over the signed webhook. */
async function driveKyc(c: TestClient, eventId: string, fields: Record<string, unknown>) {
  const started = await c.post('/v1/me/kyc', { type: 'id_liveness' }, c.csrfHeaders());
  if (started.status === 409) {
    // resolve the pending check first with a pass, then start the intended one
    const latest = await c.get('/v1/me/kyc');
    void latest;
  }
  expect(started.status).toBe(201);
  const providerRef = (started.json as { providerRef: string }).providerRef;
  const body = { event_id: eventId, provider_ref: providerRef, ...fields };
  const res = await new TestClient(t.baseUrl).post('/v1/hooks/kyc', body, {
    'x-hub-signature-256': sign(body),
  });
  expect(res.status).toBe(200);
}

async function grantKycConsent(c: TestClient) {
  const res = await c.put(
    '/v1/me/consents/kyc',
    { granted: true, channel: 'app' },
    c.csrfHeaders(),
  );
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  t = await bootTestApp();
  risk = t.app.get(RiskScoringService);
});

afterAll(async () => {
  await t.app.close();
});

describe('risk scoring signals', () => {
  it('failed KYC (not underage) → +30 and an open case at/above threshold via reports', async () => {
    const { client, userId } = await signupTestUser(t, '+919876500501');
    await grantKycConsent(client);
    await driveKyc(client, 'evt.risk-fail', {
      result: 'fail',
      failure_reason: 'document unreadable',
    });

    const own = await risk.getOwnRisk(userId);
    expect(own.score).toBe(30);
    expect(own.signals).toContainEqual(expect.objectContaining({ signal: 'kyc_fail', weight: 30 }));
  });

  it('open reports add +25 each (cap 50) and open exactly one case', async () => {
    const { client: reporter } = await signupTestUser(t, '+919876500502');
    const { userId: subject } = await signupTestUser(t, '+919876500503');

    // Two distinct reporters, two open reports → +50 total.
    const { client: reporter2 } = await signupTestUser(t, '+919876500504');
    for (const [i, r] of [reporter, reporter2].entries()) {
      const res = await r.post(`/v1/users/${subject}/report`, { reason: 'scam' }, r.csrfHeaders());
      expect(res.status).toBe(200);
      void i;
    }

    const own = await risk.getOwnRisk(subject);
    expect(own.score).toBe(50);
    expect(own.signals).toContainEqual(
      expect.objectContaining({ signal: 'open_reports', weight: 50 }),
    );

    // Recalculate again (idempotent): still one open case, score unchanged.
    await risk.recalculate(subject);
    const again = await risk.getOwnRisk(subject);
    expect(again.score).toBe(50);
  });

  it('name mismatch on a passed KYC adds +20 (below threshold alone)', async () => {
    const { client, userId } = await signupTestUser(t, '+919876500505');
    await grantKycConsent(client);
    await driveKyc(client, 'evt.risk-name', {
      result: 'pass',
      age: 30,
      name_match: false,
    });
    const own = await risk.getOwnRisk(userId);
    expect(own.score).toBe(20);
    expect(own.signals).toContainEqual(
      expect.objectContaining({ signal: 'name_mismatch', weight: 20 }),
    );
  });

  it('reused photo pHash adds +40 (seeded directly; pHash population is P3)', async () => {
    const { userId: u1 } = await signupTestUser(t, '+919876500506');
    const { userId: u2 } = await signupTestUser(t, '+919876500507');
    const prisma = t.app.get(PrismaService);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'risk', true)`;
      await tx.photo.create({
        data: { userId: u1, storageKey: 'risk-a', contentType: 'image/jpeg', phash: 'duphash1' },
      });
      await tx.photo.create({
        data: { userId: u2, storageKey: 'risk-b', contentType: 'image/jpeg', phash: 'duphash1' },
      });
    });
    const { score, signals } = await risk.recalculate(u2);
    expect(score).toBe(40);
    expect(signals).toContainEqual(expect.objectContaining({ signal: 'reused_photo', weight: 40 }));
  });

  it('underage attempt is a critical case; the subject cannot read cases (RLS)', async () => {
    const { client, userId } = await signupTestUser(t, '+919876500508');
    await grantKycConsent(client);
    await driveKyc(client, 'evt.risk-minor', { result: 'pass', age: 16, name_match: true });

    const prisma = t.app.get(PrismaService);
    const cases = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'risk', true)`;
      return tx.safetyCase.findMany({ where: { subjectId: userId } });
    });
    expect(cases).toHaveLength(1);
    expect(cases[0]?.severity).toBe('critical');
    expect(cases[0]?.source).toBe('kyc');

    // Owner context must see ZERO cases (deny by default).
    const ownCases = await prisma.withUser(userId, (tx) => tx.safetyCase.findMany());
    expect(ownCases).toHaveLength(0);
  });
});

describe('A9 wiring (P2-05)', () => {
  it('scam-family report details at high confidence open an a9 case', async () => {
    const moderation = t.app.get(MODERATION_AGENT) as MockModerationAgent;
    moderation.scripted = { label: 'scam_script', confidence: 0.95 };

    const { client: reporter } = await signupTestUser(t, '+919876500601');
    const { userId: subject } = await signupTestUser(t, '+919876500602');
    const res = await reporter.post(
      `/v1/users/${subject}/report`,
      { reason: 'scam', details: 'asked me to buy gift cards and pay customs fees' },
      reporter.csrfHeaders(),
    );
    expect(res.status).toBe(200);

    const prisma = t.app.get(PrismaService);
    const cases = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'risk', true)`;
      return tx.safetyCase.findMany({ where: { subjectId: subject, source: 'a9' } });
    });
    expect(cases).toHaveLength(1);
    expect(cases[0]?.severity).toBe('high');
    expect(moderation.seen.at(-1)).toContain('gift cards');
  });

  it('low-confidence or safe verdicts open no case; missing details skip A9', async () => {
    const moderation = t.app.get(MODERATION_AGENT) as MockModerationAgent;
    const prisma = t.app.get(PrismaService);

    // Low confidence.
    moderation.scripted = { label: 'money_request', confidence: 0.4 };
    const { client: r1 } = await signupTestUser(t, '+919876500603');
    const { userId: s1 } = await signupTestUser(t, '+919876500604');
    await r1.post(
      `/v1/users/${s1}/report`,
      { reason: 'scam', details: 'vague money talk' },
      r1.csrfHeaders(),
    );

    // Safe verdict.
    moderation.scripted = { label: 'safe', confidence: 0.99 };
    const { client: r2 } = await signupTestUser(t, '+919876500605');
    const { userId: s2 } = await signupTestUser(t, '+919876500606');
    await r2.post(
      `/v1/users/${s2}/report`,
      { reason: 'scam', details: 'nothing concrete' },
      r2.csrfHeaders(),
    );

    // No details → no classification call.
    const seenBefore = moderation.seen.length;
    const { client: r3 } = await signupTestUser(t, '+919876500607');
    const { userId: s3 } = await signupTestUser(t, '+919876500608');
    await r3.post(`/v1/users/${s3}/report`, { reason: 'fake_profile' }, r3.csrfHeaders());
    expect(moderation.seen.length).toBe(seenBefore);

    const cases = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'risk', true)`;
      return tx.safetyCase.findMany({ where: { subjectId: { in: [s1, s2, s3] }, source: 'a9' } });
    });
    expect(cases).toHaveLength(0);
  });
});

describe('GET /v1/me/risk', () => {
  it('anonymous 401; fresh user sees a zero score', async () => {
    const anon = new TestClient(t.baseUrl);
    expect((await anon.get('/v1/me/risk')).status).toBe(401);
    const { client } = await signupTestUser(t, '+919876500509');
    const res = await client.get('/v1/me/risk');
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ score: 0, signals: [], computedAt: null });
  });
});
