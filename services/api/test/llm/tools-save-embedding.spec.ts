/**
 * P3-01: A2's `save_embedding` internal tool.
 * - valid scoped token (allow-list + user binding) writes a 1024-dim vector
 * - wrong user binding → 403; token without the tool → 403; no token → 401
 * - wrong dimensionality / non-finite values → 400
 * - storage is verifiable via raw SQL (pgvector roundtrip)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, signupTestUser, type TestClient, type TestApp } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { mintAgentToken } from '../../src/modules/llm-gateway/agent-token';
import { seedTaxonomy } from '../../prisma/seed-taxonomy-runner';

const SECRET = 'dev-agent-token-hmac-secret';

let t: TestApp;
let client: TestClient;
let userId: string;

const tokenFor = (user: string, tools: string[], agent = 'A2-extractor') =>
  mintAgentToken(SECRET, { agent, acting_for_user_id: user, tools }, 600);

const unit = (i: number) => {
  const v = new Array(1024).fill(0);
  v[i] = 1;
  return v;
};

beforeAll(async () => {
  t = await bootTestApp();
  const admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
  await seedTaxonomy(admin);
  await admin.$disconnect();
  ({ client, userId } = await signupTestUser(t, '+919100000601'));
  // ensure the profile row exists
  const res = await client.req(
    'POST',
    '/v1/internal/tools/save_profile_fields',
    { userId, fields: { profession: 'Doctor' } },
    { 'x-agent-token': tokenFor(userId, ['save_profile_fields']) },
  );
  expect(res.status).toBe(200);
});

afterAll(async () => {
  await t.app.close();
});

describe('save_embedding tool (P3-01)', () => {
  it('writes a 1024-dim embedding for the acting user', async () => {
    const res = await client.req(
      'POST',
      '/v1/internal/tools/save_embedding',
      { userId, vector: unit(0) },
      { 'x-agent-token': tokenFor(userId, ['save_embedding']) },
    );
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });

    const admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
    const rows = await admin.$queryRaw<Array<{ emb: string | null }>>`
      SELECT "embedding"::text AS emb FROM "profiles" WHERE "user_id" = ${userId}::uuid`;
    await admin.$disconnect();
    expect(rows[0]?.emb).not.toBeNull();
    expect(rows[0]?.emb).toContain('[1,0,0');
  });

  it('overwrites with a different vector (idempotent re-embed)', async () => {
    const res = await client.req(
      'POST',
      '/v1/internal/tools/save_embedding',
      { userId, vector: unit(5) },
      { 'x-agent-token': tokenFor(userId, ['save_embedding']) },
    );
    expect(res.status).toBe(200);
    const admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
    const rows = await admin.$queryRaw<Array<{ emb: string | null }>>`
      SELECT "embedding"::text AS emb FROM "profiles" WHERE "user_id" = ${userId}::uuid`;
    await admin.$disconnect();
    // vector(1024) textual form starts with the first components
    expect(rows[0]?.emb).toMatch(/^\[0,0,0,0,0,1,/);
  });

  it('rejects a token bound to a different user (403)', async () => {
    const res = await client.req(
      'POST',
      '/v1/internal/tools/save_embedding',
      { userId, vector: unit(0) },
      { 'x-agent-token': tokenFor('00000000-0000-0000-0000-000000000000', ['save_embedding']) },
    );
    expect(res.status).toBe(403);
  });

  it('rejects a token whose allow-list lacks save_embedding (403)', async () => {
    const res = await client.req(
      'POST',
      '/v1/internal/tools/save_embedding',
      { userId, vector: unit(0) },
      { 'x-agent-token': tokenFor(userId, ['get_profile_draft']) },
    );
    expect(res.status).toBe(403);
  });

  it('rejects anonymous calls (401)', async () => {
    const res = await client.req('POST', '/v1/internal/tools/save_embedding', {
      userId,
      vector: unit(0),
    });
    expect(res.status).toBe(401);
  });

  it('rejects wrong dimensionality (400)', async () => {
    const res = await client.req(
      'POST',
      '/v1/internal/tools/save_embedding',
      { userId, vector: [1, 0, 0] },
      { 'x-agent-token': tokenFor(userId, ['save_embedding']) },
    );
    expect(res.status).toBe(400);
  });

  it('rejects out-of-range values (400)', async () => {
    const bad = unit(0);
    bad[1] = 1e9;
    const res = await client.req(
      'POST',
      '/v1/internal/tools/save_embedding',
      { userId, vector: bad },
      { 'x-agent-token': tokenFor(userId, ['save_embedding']) },
    );
    expect(res.status).toBe(400);
  });

  it('RLS: owner context enforced (write only reachable with the owner binding)', async () => {
    // A token minted for a second user cannot act on the first user's
    // profile even with save_embedding in its allow-list (guard rejects the
    // binding before the service runs; the service itself is owner-scoped).
    const { userId: other } = await signupTestUser(t, '+919100000602');
    const res = await client.req(
      'POST',
      '/v1/internal/tools/save_embedding',
      { userId, vector: unit(0) },
      { 'x-agent-token': tokenFor(other, ['save_embedding']) },
    );
    expect(res.status).toBe(403);
  });
});
