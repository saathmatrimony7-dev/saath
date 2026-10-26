/**
 * P3-02: embedding provenance + stale-embedding sweep.
 * - save_embedding persists summaryHash/modelVersion/profileVersion/prefVersion
 *   and embedding_updated_at (read back via admin raw SQL — tests run as
 *   app_login under RLS)
 * - bad provenance values → 400
 * - listStaleEmbeddings: flags never-embedded, profile_version bump (PATCH),
 *   preference version bump (PUT /v1/me/preferences); cleared by re-embed
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, signupTestUser, type TestClient, type TestApp } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { mintAgentToken } from '../../src/modules/llm-gateway/agent-token';
import { ProfilesService } from '../../src/modules/profiles/profiles.service';
import { seedTaxonomy } from '../../prisma/seed-taxonomy-runner';

const SECRET = 'dev-agent-token-hmac-secret';

let t: TestApp;
let client: TestClient;
let userId: string;
let profiles: ProfilesService;

const tokenFor = (user: string, tools: string[], agent = 'A2-extractor') =>
  mintAgentToken(SECRET, { agent, acting_for_user_id: user, tools }, 600);

const HASH = 'a'.repeat(64);

const unit = (i: number) => {
  const v = new Array(1024).fill(0);
  v[i] = 1;
  return v;
};

/** Admin (superuser) raw read-back of the provenance columns. */
async function readProvenance(uid: string) {
  const admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
  const rows = await admin.$queryRaw<
    Array<{
      embedding_summary_hash: string | null;
      embedding_model_version: string | null;
      embedding_profile_version: number | null;
      embedding_pref_version: number | null;
      embedding_updated_at: Date | null;
      profile_version: number;
    }>
  >`SELECT "embedding_summary_hash", "embedding_model_version",
            "embedding_profile_version", "embedding_pref_version",
            "embedding_updated_at", "profile_version"
       FROM "profiles" WHERE "user_id" = ${uid}::uuid`;
  await admin.$disconnect();
  return rows[0];
}

const saveEmbedding = (body: Record<string, unknown>, uid = userId) =>
  client.req('POST', '/v1/internal/tools/save_embedding', body, {
    'x-agent-token': tokenFor(uid, ['save_embedding']),
  });

beforeAll(async () => {
  t = await bootTestApp();
  const admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
  await seedTaxonomy(admin);
  await admin.$disconnect();
  ({ client, userId } = await signupTestUser(t, '+919100000701'));
  profiles = t.app.get(ProfilesService);
  // ensure the profile row exists (profile_version starts at 1)
  const res = await client.req(
    'POST',
    '/v1/internal/tools/save_profile_fields',
    { userId, fields: { profession: 'Doctor' } },
    { 'x-agent-token': tokenFor(userId, ['save_profile_fields']) },
  );
  expect(res.status).toBe(200);
  // Create preferences (version 1) so embed-time pref_version has a live
  // counterpart — NULL (no row) would always diff against any stored int.
  const prefs = await client.put(
    '/v1/me/preferences',
    { ageMin: 25, ageMax: 35, dietOk: ['veg'] },
    client.csrfHeaders(),
  );
  expect(prefs.status).toBe(200);
});

afterAll(async () => {
  await t.app.close();
});

describe('save_embedding provenance (P3-02)', () => {
  it('persists all provenance columns + updated_at', async () => {
    const res = await saveEmbedding({
      userId,
      vector: unit(0),
      summaryHash: HASH,
      modelVersion: 'BAAI/bge-m3',
      profileVersion: 1,
      prefVersion: 1,
    });
    expect(res.status).toBe(200);

    const row = await readProvenance(userId);
    expect(row?.embedding_summary_hash).toBe(HASH);
    expect(row?.embedding_model_version).toBe('BAAI/bge-m3');
    expect(row?.embedding_profile_version).toBe(1);
    expect(row?.embedding_pref_version).toBe(1);
    expect(row?.embedding_updated_at).not.toBeNull();
  });

  it('vector-only call keeps existing provenance (no clearing)', async () => {
    const res = await saveEmbedding({ userId, vector: unit(1) });
    expect(res.status).toBe(200);
    const row = await readProvenance(userId);
    expect(row?.embedding_summary_hash).toBe(HASH);
    expect(row?.embedding_model_version).toBe('BAAI/bge-m3');
  });

  it.each([
    ['bad hash', { summaryHash: 'not-a-hash' }],
    ['uppercase hash', { summaryHash: 'A'.repeat(64) }],
    ['short hash', { summaryHash: 'ab'.repeat(20) }],
    ['oversized modelVersion', { modelVersion: 'x'.repeat(65) }],
    ['zero profileVersion', { profileVersion: 0 }],
    ['negative prefVersion', { prefVersion: -2 }],
    ['non-integer version', { profileVersion: 1.5 }],
  ])('rejects %s with 400', async (_label, meta) => {
    const res = await saveEmbedding({ userId, vector: unit(0), ...meta });
    expect(res.status).toBe(400);
  });
});

describe('listStaleEmbeddings (P3-02)', () => {
  it('flags a profile that was never embedded', async () => {
    const { userId: fresh } = await signupTestUser(t, '+919100000702');
    await client.req(
      'POST',
      '/v1/internal/tools/save_profile_fields',
      { userId: fresh, fields: { profession: 'Teacher' } },
      { 'x-agent-token': tokenFor(fresh, ['save_profile_fields']) },
    );
    const stale = await profiles.listStaleEmbeddings(10_000);
    expect(stale).toContain(fresh);
  });

  it('clears after embedding with the live versions, re-flags on profile edit', async () => {
    // userId was embedded above with profileVersion=1 — currently fresh.
    expect(await profiles.listStaleEmbeddings(100)).not.toContain(userId);

    // PATCH /v1/me/profile bumps profile_version → stale again.
    const patched = await client.patch(
      '/v1/me/profile',
      { profession: 'Surgeon' },
      client.csrfHeaders(),
    );
    expect(patched.status).toBe(200);
    const afterPatch = await readProvenance(userId);
    expect(afterPatch?.profile_version).toBeGreaterThan(
      afterPatch?.embedding_profile_version ?? 0,
    );
    expect(await profiles.listStaleEmbeddings(10_000)).toContain(userId);

    // Re-embed with the new profile version → fresh again.
    const save = await saveEmbedding({
      userId,
      vector: unit(2),
      summaryHash: 'b'.repeat(64),
      profileVersion: afterPatch!.profile_version,
      prefVersion: 1,
    });
    expect(save.status).toBe(200);
    expect(await profiles.listStaleEmbeddings(10_000)).not.toContain(userId);
  });

  it('re-flags on preference version change, clears after re-embed', async () => {
    const put = await client.put(
      '/v1/me/preferences',
      { ageMin: 25, ageMax: 40, dietOk: ['veg'] },
      client.csrfHeaders(),
    );
    expect(put.status).toBe(200);
    const prefVersion = (put.json as unknown as { preference: { version: number } }).preference
      .version;
    expect(await profiles.listStaleEmbeddings(10_000)).toContain(userId);

    const current = await readProvenance(userId);
    const save = await saveEmbedding({
      userId,
      vector: unit(3),
      summaryHash: 'c'.repeat(64),
      profileVersion: current!.profile_version,
      prefVersion,
    });
    expect(save.status).toBe(200);
    expect(await profiles.listStaleEmbeddings(100)).not.toContain(userId);
  });

  it('respects the limit parameter and validates it', async () => {
    const stale = await profiles.listStaleEmbeddings(1);
    expect(stale.length).toBeLessThanOrEqual(1);
    await expect(profiles.listStaleEmbeddings(0)).rejects.toThrow();
    await expect(profiles.listStaleEmbeddings(1.5)).rejects.toThrow();
  });
});
