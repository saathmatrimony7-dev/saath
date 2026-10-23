/**
 * Consent ledger tests (P1-02, DESIGN.md A6 — "consents recorded" exit criterion):
 * - signup appends matchmaking + agent_screening rows (channel otp_signup)
 * - GET shows latest state per purpose immediately after withdrawal/re-grant
 * - ledger is append-only: app role has no UPDATE/DELETE grant (revocation = new row)
 * - authz: anonymous 401, PUT without CSRF 403, one user never sees another's rows
 * - strict DTOs: unknown purpose / unknown fields rejected
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, signupTestUser, TestClient, type TestApp } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';

let t: TestApp;
let client: TestClient;
let userId: string;
let other: TestClient;

interface ConsentState {
  purpose: string;
  granted: boolean | null;
  noticeVersion: string | null;
  channel: string | null;
  updatedAt: string | null;
}

async function consentRowsFor(id: string): Promise<number> {
  const admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
  const rows = await admin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n
    FROM consents WHERE user_id = ${id}::uuid`;
  await admin.$disconnect();
  return Number(rows[0]?.n ?? 0);
}

beforeAll(async () => {
  t = await bootTestApp();
  ({ client, userId } = await signupTestUser(t, '+919100000101'));
  other = (await signupTestUser(t, '+919100000102')).client;
});

afterAll(async () => {
  await t.app.close();
});

describe('consent ledger', () => {
  it('records matchmaking + agent_screening at OTP signup', async () => {
    const res = await client.get('/v1/me/consents');
    expect(res.status).toBe(200);
    const states = res.json as unknown as ConsentState[];
    expect(states).toHaveLength(6);
    const byPurpose = new Map(states.map((s) => [s.purpose, s]));
    for (const p of ['matchmaking', 'agent_screening']) {
      const s = byPurpose.get(p);
      expect(s?.granted).toBe(true);
      expect(s?.channel).toBe('otp_signup');
      expect(s?.noticeVersion).toBeTruthy();
      expect(s?.updatedAt).toBeTruthy();
    }
    // Untouched purposes are null, never implied-true.
    expect(byPurpose.get('marketing')?.granted).toBeNull();
    expect(byPurpose.get('whatsapp')?.granted).toBeNull();
  });

  it('does NOT duplicate consent rows when an existing user logs in again', async () => {
    const before = await consentRowsFor(userId);
    await signupTestUser(t, '+919100000101'); // same phone → existing user
    expect(await consentRowsFor(userId)).toBe(before);
  });

  it('withdrawal is a new row reflected immediately in GET', async () => {
    const put = await client.put(
      '/v1/me/consents/marketing',
      { granted: false },
      client.csrfHeaders(),
    );
    expect(put.status).toBe(200);
    expect((put.json as unknown as { granted: boolean }).granted).toBe(false);

    const res = await client.get('/v1/me/consents');
    const marketing = (res.json as unknown as ConsentState[]).find(
      (s) => s.purpose === 'marketing',
    );
    expect(marketing?.granted).toBe(false);
    expect(marketing?.channel).toBe('app');

    // Re-grant appends another row; latest wins again.
    await client.put('/v1/me/consents/marketing', { granted: true }, client.csrfHeaders());
    const after = await client.get('/v1/me/consents');
    expect(
      (after.json as unknown as ConsentState[]).find((s) => s.purpose === 'marketing')?.granted,
    ).toBe(true);
    expect(await consentRowsFor(userId)).toBe(4); // 2 signup + withdraw + re-grant
  });

  it('rejects unknown purpose and non-boolean granted (strict DTO)', async () => {
    const badPurpose = await client.put(
      '/v1/me/consents/whatever',
      { granted: true },
      client.csrfHeaders(),
    );
    expect(badPurpose.status).toBe(400);
    const badBody = await client.put(
      '/v1/me/consents/kyc',
      { granted: 'yes' },
      client.csrfHeaders(),
    );
    expect(badBody.status).toBe(400);
    const extraField = await client.put(
      '/v1/me/consents/kyc',
      { granted: true, notice: 'x' },
      client.csrfHeaders(),
    );
    expect(extraField.status).toBe(400);
  });

  it('anonymous denied; PUT without CSRF denied', async () => {
    const anon = new TestClient(t.baseUrl);
    expect((await anon.get('/v1/me/consents')).status).toBe(401);
    expect((await anon.put('/v1/me/consents/kyc', { granted: true })).status).toBe(401);
    const noCsrf = await client.put('/v1/me/consents/kyc', { granted: true });
    expect(noCsrf.status).toBe(403);
  });

  it('one user never sees another user’s consent state', async () => {
    await client.put('/v1/me/consents/whatsapp', { granted: true }, client.csrfHeaders());
    const foreign = await other.get('/v1/me/consents');
    expect(
      (foreign.json as unknown as ConsentState[]).find((s) => s.purpose === 'whatsapp')?.granted,
    ).toBeNull();
  });

  it('append-only: UPDATE/DELETE as the app role are denied', async () => {
    const appDb = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().appUrl } } });
    await appDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      await expect(
        tx.$executeRaw`UPDATE consents SET granted = false WHERE user_id = ${userId}::uuid`,
      ).rejects.toThrow();
      await expect(
        tx.$executeRaw`DELETE FROM consents WHERE user_id = ${userId}::uuid`,
      ).rejects.toThrow();
    });
    await appDb.$disconnect();
  });
});
