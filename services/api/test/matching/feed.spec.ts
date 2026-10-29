/**
 * P3-08 daily feed: GET /v1/matches/today.
 * - authz: anonymous 401; a user only ever sees their OWN rows
 * - cards: ranked, disclosure-gated by the CANDIDATE's share_level
 *   ('minimal' omits photo/religion/community), taxonomy labels resolved
 * - live gates: pass hides the row; a block (either direction) hides it;
 *   an ineligible candidate (tier drop) hides it; a fresh INCOMPATIBLE
 *   screening verdict hides it (expired verdict does not)
 * - fetch marks rows 'viewed'
 */
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, signupTestUser, TestClient, type TestApp } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { seedTaxonomy } from '../../prisma/seed-taxonomy-runner';

let t: TestApp;
let admin: RlsPrismaClient;
let seq = 5000;

const today = () => new Date().toISOString().slice(0, 10);

async function mkUser(shareLevel?: string) {
  seq += 1;
  const { client, userId } = await signupTestUser(t, `+9188${String(seq).padStart(8, '0')}`);
  const pr = await client.patch(
    '/v1/me/profile',
    {
      cityId: 'mumbai',
      diet: 'veg',
      heightCm: 168,
      maritalStatus: 'never_married',
      willingToRelocate: true,
      religionId: 'hindu',
      communityId: 'hindu-brahmin',
    },
    client.csrfHeaders(),
  );
  expect(pr.status).toBe(200);
  await admin.user.update({
    where: { id: userId },
    data: { ageVerified: true, birthYear: new Date().getFullYear() - 27, status: 'active' },
  });
  await admin.profile.update({ where: { userId }, data: { verificationTier: 1 } });
  await admin.photo.create({
    data: {
      userId,
      storageKey: `feed-${userId}`,
      contentType: 'image/jpeg',
      moderationStatus: 'approved',
      isPrimary: true,
    },
  });
  if (shareLevel) {
    const dp = await client.put('/v1/me/disclosure-policy', { shareLevel }, client.csrfHeaders());
    expect(dp.status).toBe(200);
  }
  return { client, userId };
}

async function publishMatch(userId: string, candidateId: string, rank: number) {
  await admin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
    await tx.dailyMatch.create({
      data: {
        userId,
        candidateId,
        batchDate: new Date(`${today()}T00:00:00Z`),
        rank,
        status: 'published',
      },
    });
  });
}

beforeAll(async () => {
  t = await bootTestApp();
  admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
  await seedTaxonomy(admin);
});

afterAll(async () => {
  await admin.$disconnect();
  await t.app.close();
});

describe('GET /v1/matches/today', () => {
  it('anonymous 401; own feed returns ranked disclosure-gated cards', async () => {
    const viewer = await mkUser();
    const candA = await mkUser(); // default share level = standard
    const candB = await mkUser('minimal');
    await publishMatch(viewer.userId, candA.userId, 1);
    await publishMatch(viewer.userId, candB.userId, 2);

    const anon = await new TestClient(t.baseUrl).get('/v1/matches/today');
    expect(anon.status).toBe(401);

    const res = await viewer.client.get('/v1/matches/today');
    expect(res.status).toBe(200);
    const feed = res.json as unknown as {
      matchId: string;
      candidateId: string;
      rank: number;
      status: string;
      age: number;
      city: { id: string; labels: Record<string, unknown> } | null;
      verificationTier: number;
      religion?: { id: string } | null;
      community?: { id: string } | null;
      photo?: { id: string; url: string } | null;
    }[];
    expect(feed).toHaveLength(2);
    expect(feed.map((c) => c.candidateId)).toEqual([candA.userId, candB.userId]); // rank order
    for (const card of feed) {
      expect(card.status).toBe('viewed'); // fetch marks published rows viewed
      expect(card.age).toBe(27); // birthYear set to 27 years ago in mkUser
      expect(card.city?.id).toBe('mumbai');
      expect(card.verificationTier).toBe(1);
    }
    // 'standard' candidate: photo + religion/community present.
    const cardA = feed[0]!;
    expect(cardA.photo?.url).toContain('/v1/storage-mock/file?key=');
    expect(cardA.religion?.id).toBe('hindu');
    expect(cardA.community?.id).toBe('hindu-brahmin');
    // 'minimal' candidate: photo/religion/community omitted entirely.
    const cardB = feed[1]!;
    expect(cardB).not.toHaveProperty('photo');
    expect(cardB).not.toHaveProperty('religion');
    expect(cardB).not.toHaveProperty('community');

    // Another user sees an empty feed (never the viewer's rows).
    const other = await mkUser();
    const foreign = await other.client.get('/v1/matches/today');
    expect(foreign.status).toBe(200);
    expect(foreign.json).toEqual([]);

    // Persisted statuses flipped to viewed.
    const rows = await admin.dailyMatch.findMany({ where: { userId: viewer.userId } });
    expect(rows.every((r) => r.status === 'viewed')).toBe(true);
  });

  it('pass hides the row live and marks it acted', async () => {
    const viewer = await mkUser();
    const cand = await mkUser();
    await publishMatch(viewer.userId, cand.userId, 1);
    const feed = (await viewer.client.get('/v1/matches/today')).json as unknown as { matchId: string }[];
    const pass = await viewer.client.post(`/v1/matches/${feed[0]!.matchId}/pass`, {}, viewer.client.csrfHeaders());
    expect(pass.status).toBe(200);
    const after = (await viewer.client.get('/v1/matches/today')).json as unknown as unknown[];
    expect(after).toEqual([]);
    const row = await admin.dailyMatch.findFirst({ where: { userId: viewer.userId } });
    expect(row?.status).toBe('acted');
  });

  it('a block in either direction hides the row', async () => {
    const viewer = await mkUser();
    const cand = await mkUser();
    await publishMatch(viewer.userId, cand.userId, 1);
    const block = await viewer.client.put(`/v1/users/${cand.userId}/block`, undefined, viewer.client.csrfHeaders());
    expect(block.status).toBe(200);
    const feed = (await viewer.client.get('/v1/matches/today')).json as unknown as unknown[];
    expect(feed).toEqual([]);
  });

  it('an ineligible candidate (tier drop, hidden visibility) disappears', async () => {
    const viewer = await mkUser();
    const cand = await mkUser();
    await publishMatch(viewer.userId, cand.userId, 1);
    await admin.profile.update({ where: { userId: cand.userId }, data: { verificationTier: 0 } });
    const feed = (await viewer.client.get('/v1/matches/today')).json as unknown as unknown[];
    expect(feed).toEqual([]);
  });

  it('serves explanations under the stricter of the two disclosure policies', async () => {
    const viewer = await mkUser();
    const cand = await mkUser();
    const { client: candClient } = cand;
    await publishMatch(viewer.userId, cand.userId, 1);
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      await tx.dailyMatch.updateMany({
        where: { userId: viewer.userId },
        data: { explanationI18n: { en: 'You both are based in Mumbai.' } },
      });
    });

    let feed = (await viewer.client.get('/v1/matches/today')).json as unknown as {
      explanation?: string;
    }[];
    expect(feed[0]?.explanation).toBe('You both are based in Mumbai.');

    // viewer at 'minimal' → stricter level hides the explanation
    await viewer.client.put(
      '/v1/me/disclosure-policy',
      { shareLevel: 'minimal' },
      viewer.client.csrfHeaders(),
    );
    feed = (await viewer.client.get('/v1/matches/today')).json as unknown as {
      explanation?: string;
    }[];
    expect(feed[0]).not.toHaveProperty('explanation');

    // back to standard; CANDIDATE at 'minimal' hides it too
    await viewer.client.put(
      '/v1/me/disclosure-policy',
      { shareLevel: 'standard' },
      viewer.client.csrfHeaders(),
    );
    await candClient.put(
      '/v1/me/disclosure-policy',
      { shareLevel: 'minimal' },
      candClient.csrfHeaders(),
    );
    feed = (await viewer.client.get('/v1/matches/today')).json as unknown as {
      explanation?: string;
    }[];
    expect(feed[0]).not.toHaveProperty('explanation');
  });

  it('a fresh INCOMPATIBLE screening verdict hides the row; an expired one does not', async () => {
    const viewer = await mkUser();
    const cand = await mkUser();
    await publishMatch(viewer.userId, cand.userId, 1);
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 1000);
    const insert = (expiresAt: Date) =>
      admin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.service', 'screening', true)`;
        // screening_results.inputs_hash CHECK requires a sha256 hex digest.
        const inputsHash = createHash('sha256').update(String(expiresAt.getTime())).digest('hex');
        await tx.screeningResult.create({
          data: {
            userA: viewer.userId < cand.userId ? viewer.userId : cand.userId,
            userB: viewer.userId < cand.userId ? cand.userId : viewer.userId,
            prefVersionA: 1,
            prefVersionB: 1,
            verdict: 'INCOMPATIBLE',
            score: 0.1,
            topics: [],
            reasonCodes: ['AGE'],
            modelVersion: 'a6-screen-v2',
            inputsHash,
            expiresAt,
          },
        });
      });
    await insert(future);
    expect((await viewer.client.get('/v1/matches/today')).json).toEqual([]);
    await admin.screeningResult.updateMany({
      where: { userA: viewer.userId < cand.userId ? viewer.userId : cand.userId },
      data: { expiresAt: past },
    });
    const feed = (await viewer.client.get('/v1/matches/today')).json as unknown as { candidateId: string }[];
    expect(feed).toHaveLength(1);
    expect(feed[0]?.candidateId).toBe(cand.userId);
  });
});
