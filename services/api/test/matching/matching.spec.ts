/**
 * Matching tests (P3-03, DESIGN.md §8 steps 1-2 + §7.3 Stage 1):
 * - eligiblePool: tier/ageVerified/status/visibility/photo gates, block
 *   exclusion in both directions, self exclusion
 * - hardFilterCheck matrices: age (both directions), height, cities,
 *   relocate, diet/marital (incl. null fail-closed), community filter,
 *   dealbreaker ops (eq/neq/in/not_in/lt/gt), unknown field, null values
 * - reason codes stay inside the closed vocabulary
 * - internal endpoints: service token required, happy path, 404 for
 *   unknown ids (indistinguishable from missing), strict-body 400s
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, signupTestUser, TestClient, type TestApp } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { seedTaxonomy } from '../../prisma/seed-taxonomy-runner';
import {
  MatchingService,
  HARD_FILTER_REASON_CODES,
  DEALBREAKER_FIELDS,
} from '../../src/modules/matching/matching.service';

let t: TestApp;
let admin: RlsPrismaClient;
let matching: MatchingService;
let seq = 0;

const REF_YEAR = new Date().getFullYear();
const INTERNAL_TOKEN = { 'x-internal-token': 'test-internal-token-0123456789' };

const DEFAULT_PROFILE = {
  cityId: 'mumbai',
  diet: 'veg',
  heightCm: 170,
  maritalStatus: 'never_married',
  willingToRelocate: true,
  religionId: 'hindu',
  communityId: 'hindu-brahmin',
};

interface MkOpts {
  profile?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  dealbreakers?: { field: string; rule: { op: string; value: unknown } }[];
  tier?: number;
  ageVerified?: boolean;
  birthYear?: number | null;
  status?: string;
  photo?: boolean;
  photoStatus?: string;
}

/** Verified user with profile + preferences + approved photo. */
async function mkUser(o: MkOpts = {}): Promise<{ client: TestClient; userId: string }> {
  seq += 1;
  const { client, userId } = await signupTestUser(t, `+9194${String(seq).padStart(8, '0')}`);
  const csrf = client.csrfHeaders();
  const profile: Record<string, unknown> = { ...DEFAULT_PROFILE, ...o.profile };
  for (const k of Object.keys(profile)) {
    if (profile[k] === undefined) delete profile[k];
  }
  const pr = await client.patch('/v1/me/profile', profile, csrf);
  expect(pr.status, `profile patch: ${JSON.stringify(pr.json)}`).toBe(200);
  if (o.preferences) {
    const pp = await client.put('/v1/me/preferences', o.preferences, csrf);
    expect(pp.status, `preferences put: ${JSON.stringify(pp.json)}`).toBe(200);
  }
  if (o.dealbreakers) {
    const pd = await client.put('/v1/me/dealbreakers', { dealbreakers: o.dealbreakers }, csrf);
    expect(pd.status, `dealbreakers put: ${JSON.stringify(pd.json)}`).toBe(200);
  }
  await admin.user.update({
    where: { id: userId },
    data: {
      ageVerified: o.ageVerified ?? true,
      birthYear: o.birthYear ?? REF_YEAR - 28,
      status: o.status ?? 'active',
    },
  });
  await admin.profile.update({
    where: { userId },
    data: { verificationTier: o.tier ?? 1 },
  });
  if (o.photo !== false) {
    await admin.photo.create({
      data: {
        userId,
        storageKey: `match-${userId}`,
        contentType: 'image/jpeg',
        moderationStatus: o.photoStatus ?? 'approved',
      },
    });
  }
  return { client, userId };
}

const poolIds = async (forUserId: string) =>
  (await matching.eligiblePool(forUserId)).map((c) => c.userId);

const check = (a: string, b: string) => matching.hardFilterCheck(a, b);

/** Every returned reason code must come from the closed vocabulary. */
function expectClosedVocabulary(reasonCodes: string[]) {
  for (const code of reasonCodes) {
    const isDealbreaker = (DEALBREAKER_FIELDS as readonly string[]).some(
      (f) => code === `DEALBREAKER_${f.toUpperCase()}`,
    );
    expect(
      (HARD_FILTER_REASON_CODES as readonly string[]).includes(code) || isDealbreaker,
      `reason code ${code} is outside the closed vocabulary`,
    ).toBe(true);
  }
}

beforeAll(async () => {
  t = await bootTestApp();
  admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
  await seedTaxonomy(admin);
  matching = t.app.get(MatchingService);
});

afterAll(async () => {
  await admin.$disconnect();
  await t.app.close();
});

describe('eligiblePool', () => {
  it('two verified users appear in each other’s pool; self is excluded', async () => {
    const a = await mkUser();
    const b = await mkUser();
    expect(await poolIds(a.userId)).toContain(b.userId);
    expect(await poolIds(b.userId)).toContain(a.userId);
    expect(await poolIds(a.userId)).not.toContain(a.userId);
  });

  it('excludes tier 0, age-unverified, blocked-status and hidden users', async () => {
    const base = await mkUser();
    const tier0 = await mkUser({ tier: 0 });
    const unverified = await mkUser({ ageVerified: false });
    const blockedStatus = await mkUser({ status: 'blocked' });
    const hidden = await mkUser({ profile: { visibility: 'hidden' } });
    const pool = await poolIds(base.userId);
    expect(pool).not.toContain(tier0.userId);
    expect(pool).not.toContain(unverified.userId);
    expect(pool).not.toContain(blockedStatus.userId);
    expect(pool).not.toContain(hidden.userId);
  });

  it('excludes users without an approved photo', async () => {
    const base = await mkUser();
    const noPhoto = await mkUser({ photo: false });
    const pending = await mkUser({ photoStatus: 'pending' });
    const pool = await poolIds(base.userId);
    expect(pool).not.toContain(noPhoto.userId);
    expect(pool).not.toContain(pending.userId);
  });

  it('excludes blocked pairs in BOTH directions', async () => {
    const a = await mkUser();
    const b = await mkUser();
    await a.client.put(`/v1/users/${b.userId}/block`, undefined, a.client.csrfHeaders());
    expect(await poolIds(a.userId)).not.toContain(b.userId);
    expect(await poolIds(b.userId)).not.toContain(a.userId);
  });

  it('does not require an embedding (last_active_at is set at signup)', async () => {
    const a = await mkUser();
    const b = await mkUser();
    const row = (await matching.eligiblePool(a.userId)).find((c) => c.userId === b.userId);
    expect(row).toBeDefined();
    expect(row?.lastActiveAt).toBeInstanceOf(Date);
  });
});

describe('hardFilterCheck — age', () => {
  it('fails when B is below A’s ageMin (AGE), symmetric for ageMax', async () => {
    const a = await mkUser({
      birthYear: REF_YEAR - 35,
      preferences: { ageMin: 30, ageMax: 45 },
    });
    const b = await mkUser({ birthYear: REF_YEAR - 25 }); // age 25 < 30
    const r1 = await check(a.userId, b.userId);
    expect(r1.compatible).toBe(false);
    expect(r1.reasonCodes).toContain('AGE');

    // Symmetric: B (25) only wants partners up to 27; A is 35.
    const c = await mkUser({ birthYear: REF_YEAR - 25, preferences: { ageMax: 27 } });
    const d = await mkUser({ birthYear: REF_YEAR - 35 });
    const r2 = await check(c.userId, d.userId);
    expect(r2.compatible).toBe(false);
    expect(r2.reasonCodes).toContain('AGE');
    expectClosedVocabulary(r2.reasonCodes);
  });

  it('passes when both ages are in range', async () => {
    const a = await mkUser({ birthYear: REF_YEAR - 30, preferences: { ageMin: 25, ageMax: 35 } });
    const b = await mkUser({ birthYear: REF_YEAR - 32 });
    expect((await check(a.userId, b.userId)).compatible).toBe(true);
  });
});

describe('hardFilterCheck — height / cities / relocate', () => {
  it('height below heightMin fails (HEIGHT); unknown height passes', async () => {
    const a = await mkUser({ preferences: { heightMin: 175 } });
    const short = await mkUser({ profile: { heightCm: 170 } });
    const noHeight = await mkUser({ profile: { heightCm: undefined } });
    const r = await check(a.userId, short.userId);
    expect(r.compatible).toBe(false);
    expect(r.reasonCodes).toContain('HEIGHT');
    expect((await check(a.userId, noHeight.userId)).compatible).toBe(true);
  });

  it('explicit city list fails a different city and a null city (CITY)', async () => {
    const a = await mkUser({ preferences: { cities: ['delhi'] } });
    const otherCity = await mkUser({ profile: { cityId: 'mumbai' } });
    const noCity = await mkUser({ profile: { cityId: undefined } });
    expect((await check(a.userId, otherCity.userId)).reasonCodes).toContain('CITY');
    expect((await check(a.userId, noCity.userId)).reasonCodes).toContain('CITY');
  });

  it('relocateOk=false requires same city or willingness to relocate (RELOCATE)', async () => {
    const a = await mkUser({
      profile: { cityId: 'mumbai', willingToRelocate: false },
      preferences: { relocateOk: false },
    });
    const moves = await mkUser({
      profile: { cityId: 'delhi', willingToRelocate: true },
    });
    const stays = await mkUser({
      profile: { cityId: 'delhi', willingToRelocate: false },
    });
    const sameCity = await mkUser({
      profile: { cityId: 'mumbai', willingToRelocate: false },
    });
    expect((await check(a.userId, moves.userId)).compatible).toBe(true);
    const r = await check(a.userId, stays.userId);
    expect(r.compatible).toBe(false);
    expect(r.reasonCodes).toContain('RELOCATE');
    expect((await check(a.userId, sameCity.userId)).compatible).toBe(true);
  });
});

describe('hardFilterCheck — diet / marital / community', () => {
  it('explicit diet list: mismatch fails DIET, null fails DIET_UNKNOWN', async () => {
    const a = await mkUser({ preferences: { dietOk: ['veg'] } });
    const meat = await mkUser({ profile: { diet: 'non_veg' } });
    const noDiet = await mkUser({ profile: { diet: undefined } });
    const r = await check(a.userId, meat.userId);
    expect(r.compatible).toBe(false);
    expect(r.reasonCodes).toContain('DIET');
    expect((await check(a.userId, noDiet.userId)).reasonCodes).toContain('DIET_UNKNOWN');
  });

  it('explicit marital list: mismatch fails MARITAL, null fails MARITAL_UNKNOWN', async () => {
    const a = await mkUser({ preferences: { maritalOk: ['never_married'] } });
    const divorced = await mkUser({ profile: { maritalStatus: 'divorced' } });
    const noStatus = await mkUser({ profile: { maritalStatus: undefined } });
    expect((await check(a.userId, divorced.userId)).reasonCodes).toContain('MARITAL');
    expect((await check(a.userId, noStatus.userId)).reasonCodes).toContain('MARITAL_UNKNOWN');
  });

  it('community filter applies only when openToAllCommunities is false', async () => {
    const a = await mkUser({
      preferences: {
        openToAllCommunities: false,
        communityFilter: { communities: ['hindu-brahmin'] },
      },
    });
    const brahmin = await mkUser({ profile: { communityId: 'hindu-brahmin' } });
    const sunni = await mkUser({ profile: { communityId: 'muslim-sunni' } });
    expect((await check(a.userId, brahmin.userId)).compatible).toBe(true);
    expect((await check(a.userId, sunni.userId)).reasonCodes).toContain('COMMUNITY');

    const open = await mkUser({
      preferences: {
        openToAllCommunities: true,
        communityFilter: { communities: ['hindu-brahmin'] },
      },
    });
    expect((await check(open.userId, sunni.userId)).compatible).toBe(true);
  });

  it('community filter with religions list constrains religionId', async () => {
    const a = await mkUser({
      preferences: { openToAllCommunities: false, communityFilter: { religions: ['hindu'] } },
    });
    const hindu = await mkUser({ profile: { religionId: 'hindu' } });
    const muslim = await mkUser({ profile: { religionId: 'muslim' } });
    expect((await check(a.userId, hindu.userId)).compatible).toBe(true);
    expect((await check(a.userId, muslim.userId)).reasonCodes).toContain('COMMUNITY');
  });
});

describe('hardFilterCheck — dealbreakers', () => {
  it('in / not_in / eq / neq / lt / gt all fail on violation, each direction', async () => {
    const a = await mkUser({
      dealbreakers: [
        { field: 'diet', rule: { op: 'in', value: ['veg', 'vegan'] } },
        { field: 'has_children', rule: { op: 'eq', value: false } },
      ],
    });
    const b = await mkUser({
      profile: { diet: 'non_veg', hasChildren: true },
      dealbreakers: [
        { field: 'diet', rule: { op: 'not_in', value: ['non_veg'] } },
        { field: 'height_cm', rule: { op: 'lt', value: 180 } }, // b requires partner < 180
        { field: 'marital_status', rule: { op: 'neq', value: 'divorced' } },
      ],
    });
    const r = await check(a.userId, b.userId);
    expect(r.compatible).toBe(false);
    // a→b: diet non_veg ∉ [veg,vegan]; has_children must be false.
    expect(r.reasonCodes).toContain('DEALBREAKER_DIET');
    expect(r.reasonCodes).toContain('DEALBREAKER_HAS_CHILDREN');
    // b→a: a.diet veg is not forbidden; a.height 170 < 180 ok;
    // a.marital never_married ≠ divorced ok.
    expect(r.reasonCodes).not.toContain('DEALBREAKER_HEIGHT_CM');
    expect(r.reasonCodes).not.toContain('DEALBREAKER_MARITAL_STATUS');
    expectClosedVocabulary(r.reasonCodes);

    const short = await mkUser({ profile: { heightCm: 150 } });
    const b2 = await mkUser({
      dealbreakers: [{ field: 'height_cm', rule: { op: 'gt', value: 160 } }],
    });
    const r2 = await check(b2.userId, short.userId);
    expect(r2.compatible).toBe(false);
    expect(r2.reasonCodes).toContain('DEALBREAKER_HEIGHT_CM');
  });

  it('unknown field: rule ignored, code DEALBREAKER_UNKNOWN_FIELD, never fails', async () => {
    const a = await mkUser({
      dealbreakers: [{ field: 'gotra', rule: { op: 'in', value: ['x'] } }],
    });
    const b = await mkUser();
    const r = await check(a.userId, b.userId);
    expect(r.compatible).toBe(true);
    expect(r.reasonCodes).toContain('DEALBREAKER_UNKNOWN_FIELD');
  });

  it('rule against a null profile value passes (cannot disprove)', async () => {
    const a = await mkUser({
      dealbreakers: [{ field: 'willing_to_relocate', rule: { op: 'eq', value: true } }],
    });
    const b = await mkUser({ profile: { willingToRelocate: undefined } });
    expect((await check(a.userId, b.userId)).compatible).toBe(true);
  });
});

describe('internal endpoints', () => {
  it('check-hard-filters: 401 without token; 200 with token; strict body 400', async () => {
    const a = await mkUser({ preferences: { ageMin: 30 } });
    const b = await mkUser({ birthYear: REF_YEAR - 25 });
    const anon = new TestClient(t.baseUrl);
    const noToken = await anon.post('/v1/internal/matching/check-hard-filters', {
      aUserId: a.userId,
      bUserId: b.userId,
    });
    expect(noToken.status).toBe(401);

    const ok = await anon.post(
      '/v1/internal/matching/check-hard-filters',
      { aUserId: a.userId, bUserId: b.userId },
      INTERNAL_TOKEN,
    );
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ compatible: false });
    expect((ok.json as { reasonCodes: string[] }).reasonCodes).toContain('AGE');

    const extra = await anon.post(
      '/v1/internal/matching/check-hard-filters',
      { aUserId: a.userId, bUserId: b.userId, debug: true },
      INTERNAL_TOKEN,
    );
    expect(extra.status).toBe(400);
    const badUuid = await anon.post(
      '/v1/internal/matching/check-hard-filters',
      { aUserId: 'nope', bUserId: b.userId },
      INTERNAL_TOKEN,
    );
    expect(badUuid.status).toBe(400);
  });

  it('unknown uuid is indistinguishable from missing (404)', async () => {
    const a = await mkUser();
    const anon = new TestClient(t.baseUrl);
    const res = await anon.post(
      '/v1/internal/matching/check-hard-filters',
      { aUserId: a.userId, bUserId: crypto.randomUUID() },
      INTERNAL_TOKEN,
    );
    expect(res.status).toBe(404);
  });

  it('stale-embeddings: 401 without token; list with token', async () => {
    const a = await mkUser();
    const anon = new TestClient(t.baseUrl);
    expect((await anon.get('/v1/internal/matching/stale-embeddings')).status).toBe(401);
    const res = await anon.get(
      '/v1/internal/matching/stale-embeddings?limit=10000',
      INTERNAL_TOKEN,
    );
    expect(res.status).toBe(200);
    const ids = res.json as unknown;
    expect(Array.isArray(ids)).toBe(true);
    expect(ids as string[]).toContain(a.userId);
  });
});
