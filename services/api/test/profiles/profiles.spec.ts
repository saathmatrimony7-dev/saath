/**
 * Profiles + preferences tests (P1-03):
 * - profile create/update with self-selected taxonomy refs (never inferred)
 * - profile_version bump; community attribute validation vs attribute_definitions
 * - preferences / dealbreakers / disclosure CRUD with version bumps
 * - authz: anonymous 401, no-CSRF 403, foreign profile 404, RLS cross-user read = 0 rows
 * - strict DTO rejections
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, signupTestUser, TestClient, type TestApp } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { seedTaxonomy } from '../../prisma/seed-taxonomy-runner';

let t: TestApp;
let client: TestClient;
let userId: string;
let other: TestClient;
let otherId: string;

interface ProfileResponse {
  profile: {
    userId: string;
    displayName: string | null;
    communityId: string | null;
    religionId: string | null;
    profileVersion: number;
  } | null;
  attributes: Array<{ attributeKey: string; value: unknown }>;
}

const csrf = () => client.csrfHeaders();

beforeAll(async () => {
  t = await bootTestApp();
  const admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
  await seedTaxonomy(admin);
  await admin.$disconnect();
  ({ client, userId } = await signupTestUser(t, '+919100000201'));
  ({ client: other, userId: otherId } = await signupTestUser(t, '+919100000202'));
});

afterAll(async () => {
  await t.app.close();
});

describe('profile', () => {
  it('starts empty, then PATCH creates with self-selected taxonomy refs', async () => {
    expect((await client.get('/v1/me/profile')).json).toEqual({
      profile: null,
      attributes: [],
    });

    const res = await client.patch(
      '/v1/me/profile',
      {
        displayName: 'Test User',
        religionId: 'hindu',
        communityId: 'hindu-brahmin',
        cityId: 'mumbai',
        diet: 'veg',
        heightCm: 170,
      },
      csrf(),
    );
    expect(res.status).toBe(200);
    const body = res.json as unknown as ProfileResponse;
    expect(body.profile?.displayName).toBe('Test User');
    expect(body.profile?.communityId).toBe('hindu-brahmin');
    expect(body.profile?.profileVersion).toBe(1);
  });

  it('bumps profile_version on update', async () => {
    const res = await client.patch('/v1/me/profile', { profession: 'Engineer' }, csrf());
    expect((res.json as unknown as ProfileResponse).profile?.profileVersion).toBe(2);
  });

  it('rejects nonexistent taxonomy refs (FK → 400)', async () => {
    const res = await client.patch('/v1/me/profile', { communityId: 'not-a-community' }, csrf());
    expect(res.status).toBe(400);
  });

  it('accepts community-scoped attribute for matching community', async () => {
    const res = await client.patch(
      '/v1/me/profile',
      { attributes: [{ key: 'gotra', value: 'Bharadwaj' }] },
      csrf(),
    );
    expect(res.status).toBe(200);
    const attrs = (res.json as unknown as ProfileResponse).attributes;
    expect(attrs.find((a) => a.attributeKey === 'gotra')?.value).toBe('Bharadwaj');
  });

  it('rejects community-scoped attribute for another community', async () => {
    const res = await client.patch(
      '/v1/me/profile',
      { communityId: 'muslim-sunni', attributes: [{ key: 'gotra', value: 'X' }] },
      csrf(),
    );
    expect(res.status).toBe(400);
    // restore
    await client.patch('/v1/me/profile', { communityId: 'hindu-brahmin' }, csrf());
  });

  it('validates single_select attribute options', async () => {
    const ok = await client.patch(
      '/v1/me/profile',
      { attributes: [{ key: 'manglik_status', value: 'manglik' }] },
      csrf(),
    );
    expect(ok.status).toBe(200);
    const bad = await client.patch(
      '/v1/me/profile',
      { attributes: [{ key: 'manglik_status', value: 'sometimes' }] },
      csrf(),
    );
    expect(bad.status).toBe(400);
  });

  it('rejects unknown attribute keys', async () => {
    const res = await client.patch(
      '/v1/me/profile',
      { attributes: [{ key: 'blood_type', value: 'O+' }] },
      csrf(),
    );
    expect(res.status).toBe(400);
  });

  it('rejects unknown fields (strict DTO)', async () => {
    const res = await client.patch('/v1/me/profile', { caste: 'x' }, csrf());
    expect(res.status).toBe(400);
    const badEnum = await client.patch('/v1/me/profile', { diet: 'carnivore' }, csrf());
    expect(badEnum.status).toBe(400);
  });
});

describe('preferences, dealbreakers, disclosure', () => {
  it('PUT preferences creates; second PUT bumps version', async () => {
    const first = await client.put(
      '/v1/me/preferences',
      { ageMin: 25, ageMax: 35, dietOk: ['veg', 'eggetarian'], openToAllCommunities: false },
      csrf(),
    );
    expect(first.status).toBe(200);
    const pref = (first.json as unknown as { preference: { version: number } }).preference;
    expect(pref.version).toBe(1);

    const second = await client.put('/v1/me/preferences', { relocateOk: true }, csrf());
    expect(
      (second.json as unknown as { preference: { version: number; relocateOk: boolean } })
        .preference.version,
    ).toBe(2);
    expect(
      (second.json as unknown as { preference: { relocateOk: boolean } }).preference.relocateOk,
    ).toBe(true);
  });

  it('dealbreakers PUT replaces the whole set with a new version', async () => {
    const put1 = await client.put(
      '/v1/me/dealbreakers',
      {
        dealbreakers: [
          { field: 'diet', rule: { op: 'eq', value: 'veg' } },
          { field: 'smoking', rule: { op: 'eq', value: true } },
        ],
      },
      csrf(),
    );
    expect(put1.status).toBe(200);
    expect((put1.json as unknown as unknown[]).length).toBe(2);

    const put2 = await client.put(
      '/v1/me/dealbreakers',
      { dealbreakers: [{ field: 'diet', rule: { op: 'in', value: ['veg', 'jain_veg'] } }] },
      csrf(),
    );
    const rows = put2.json as unknown as Array<{ version: number }>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.version).toBe(2);
  });

  it('rejects malformed dealbreaker rules', async () => {
    const res = await client.put(
      '/v1/me/dealbreakers',
      { dealbreakers: [{ field: 'diet', rule: { op: 'regex', value: '.*' } }] },
      csrf(),
    );
    expect(res.status).toBe(400);
  });

  it('disclosure policy saves and shows in preferences GET', async () => {
    const put = await client.put('/v1/me/disclosure-policy', { shareLevel: 'minimal' }, csrf());
    expect(put.status).toBe(200);
    const prefs = await client.get('/v1/me/preferences');
    expect(
      (prefs.json as unknown as { disclosure: { shareLevel: string } }).disclosure.shareLevel,
    ).toBe('minimal');
  });
});

describe('authz', () => {
  it('anonymous 401 on all /me/profile routes; mutating without CSRF 403', async () => {
    const anon = new TestClient(t.baseUrl);
    expect((await anon.get('/v1/me/profile')).status).toBe(401);
    expect((await anon.get('/v1/me/preferences')).status).toBe(401);
    expect((await anon.get('/v1/me/dealbreakers')).status).toBe(401);
    expect((await client.patch('/v1/me/profile', { diet: 'veg' })).status).toBe(403);
    expect((await client.put('/v1/me/preferences', {})).status).toBe(403);
  });

  it('foreign profile read is a 404 (existence not leaked); owner can read', async () => {
    const foreign = await other.get(`/v1/profiles/${userId}`);
    expect(foreign.status).toBe(404);
    const own = await client.get(`/v1/profiles/${userId}`);
    expect(own.status).toBe(200);
  });

  it('RLS: another user reading my profile row directly gets zero rows', async () => {
    const appDb = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().appUrl } } });
    const rows = await appDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${otherId}, true)`;
      return tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n
        FROM profiles WHERE user_id = ${userId}::uuid`;
    });
    expect(Number(rows[0]?.n ?? 0)).toBe(0);
    await appDb.$disconnect();
  });
});
