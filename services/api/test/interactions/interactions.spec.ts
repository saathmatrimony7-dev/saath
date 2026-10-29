/**
 * P3-08 interactions endpoints (DESIGN.md §9 + §19 P3 exit criteria):
 *   POST /v1/matches/:id/like | pass | shortlist
 * - authz: anonymous 401; CSRF-guarded; a foreign daily_match id 404s
 * - idempotency: repeating the same disposition is a no-op (already:true)
 * - disposition flip: pass replaces like and vice versa
 * - entitlement caps from config (booted here with like/day=2, shortlist=2)
 * - pass suppresses future appearances: the A4 get_candidates tool no
 *   longer returns the passed candidate (retrieveCandidates predicate)
 * - like/pass mark the feed row 'acted'
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, signupTestUser, TestClient, type TestApp } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { MatchingService } from '../../src/modules/matching/matching.service';
import { mintAgentToken } from '../../src/modules/llm-gateway/agent-token';
import { seedTaxonomy } from '../../prisma/seed-taxonomy-runner';

const SECRET = 'dev-agent-token-hmac-secret';

let t: TestApp;
let admin: RlsPrismaClient;
let seq = 7000;

const unit = (i: number) => {
  const v = new Array(1024).fill(0);
  v[i % 1024] = 1;
  return v;
};

async function mkUser() {
  seq += 1;
  const { client, userId } = await signupTestUser(t, `+9177${String(seq).padStart(8, '0')}`);
  const pr = await client.patch(
    '/v1/me/profile',
    {
      cityId: 'mumbai',
      diet: 'veg',
      heightCm: 170,
      maritalStatus: 'never_married',
      willingToRelocate: true,
      religionId: 'hindu',
      communityId: 'hindu-brahmin',
    },
    client.csrfHeaders(),
  );
  expect(pr.status).toBe(200);
  const pp = await client.put(
    '/v1/me/preferences',
    { relocateOk: true, dietOk: ['veg'], maritalOk: ['never_married'] },
    client.csrfHeaders(),
  );
  expect(pp.status).toBe(200);
  await admin.user.update({
    where: { id: userId },
    data: { ageVerified: true, birthYear: new Date().getFullYear() - 28, status: 'active' },
  });
  await admin.profile.update({ where: { userId }, data: { verificationTier: 1 } });
  await admin.photo.create({
    data: {
      userId,
      storageKey: `int-${userId}`,
      contentType: 'image/jpeg',
      moderationStatus: 'approved',
    },
  });
  const emb = await client.req(
    'POST',
    '/v1/internal/tools/save_embedding',
    { userId, vector: unit(seq) },
    {
      'x-agent-token': mintAgentToken(
        SECRET,
        { agent: 'A2-extractor', acting_for_user_id: userId, tools: ['save_embedding'] },
        600,
      ),
    },
  );
  expect(emb.status).toBe(200);
  return { client, userId };
}

/**
 * Publishes a daily_matches row on a FIXED-offset future batch date — never
 * real today (the endpoints under test do not gate on batch_date; today-
 * dated rows would leak into other specs' shownCounts via the shared
 * ephemeral DB; batch.spec uses DAY(+1..+4) for the same reason). Returns
 * the row id for /v1/matches/:id.
 */
async function publishMatch(userId: string, candidateId: string, rank: number) {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 5);
  const batchDate = day.toISOString().slice(0, 10);
  return admin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
    return tx.dailyMatch.create({
      data: {
        userId,
        candidateId,
        batchDate: new Date(`${batchDate}T00:00:00Z`),
        rank,
        status: 'published',
      },
    });
  });
}

async function interactionsOf(actorId: string) {
  return admin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.service', 'interactions', true)`;
    return tx.interaction.findMany({ where: { actorUserId: actorId } });
  });
}

beforeAll(async () => {
  // Tight caps so the entitlement matrix is cheap to exercise.
  process.env.MATCHING_LIKE_DAILY_LIMIT = '2';
  process.env.MATCHING_SHORTLIST_LIMIT = '2';
  t = await bootTestApp();
  admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
  await seedTaxonomy(admin);
});

afterAll(async () => {
  await admin.$disconnect();
  await t.app.close();
});

describe('POST /v1/matches/:id/like|pass|shortlist', () => {
  it('anonymous 401; missing CSRF 403; foreign match id 404', async () => {
    const viewer = await mkUser();
    const cand = await mkUser();
    const { id: matchId } = await publishMatch(viewer.userId, cand.userId, 1);

    const anon = await new TestClient(t.baseUrl).post(`/v1/matches/${matchId}/like`);
    expect(anon.status).toBe(401);

    const noCsrf = new TestClient(t.baseUrl);
    for (const [k, v] of viewer.client.cookies) {
      if (k !== 'saath_csrf') noCsrf.cookies.set(k, v);
    }
    const csrfMiss = await noCsrf.post(`/v1/matches/${matchId}/like`, {});
    expect(csrfMiss.status).toBe(403);

    const stranger = await mkUser();
    const foreign = await stranger.client.post(
      `/v1/matches/${matchId}/like`,
      {},
      stranger.client.csrfHeaders(),
    );
    expect(foreign.status).toBe(404);
  });

  it('like is idempotent and marks the feed row acted', async () => {
    const viewer = await mkUser();
    const cand = await mkUser();
    const { id: matchId } = await publishMatch(viewer.userId, cand.userId, 1);

    const first = await viewer.client.post(`/v1/matches/${matchId}/like`, {}, viewer.client.csrfHeaders());
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ matchId, type: 'like', recorded: true, already: false });
    const again = await viewer.client.post(`/v1/matches/${matchId}/like`, {}, viewer.client.csrfHeaders());
    expect(again.json).toMatchObject({ recorded: false, already: true });

    const row = await admin.dailyMatch.findFirst({ where: { id: matchId } });
    expect(row?.status).toBe('acted');
  });

  it('pass records a closed-vocabulary reason; junk reason 400s', async () => {
    const viewer = await mkUser();
    const cand = await mkUser();
    const { id: matchId } = await publishMatch(viewer.userId, cand.userId, 1);

    const junk = await viewer.client.post(
      `/v1/matches/${matchId}/pass`,
      { reasonCode: 'because_i_said_so' },
      viewer.client.csrfHeaders(),
    );
    expect(junk.status).toBe(400);
    const emptyBody = await viewer.client.post(`/v1/matches/${matchId}/pass`, {}, viewer.client.csrfHeaders());
    expect(emptyBody.status).toBe(200);
    const rows = await interactionsOf(viewer.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetUserId: cand.userId, type: 'pass', reasonCode: null });
  });

  it('like⇄pass flip: the opposite disposition is replaced', async () => {
    const viewer = await mkUser();
    const cand = await mkUser();
    const { id: matchId } = await publishMatch(viewer.userId, cand.userId, 1);

    await viewer.client.post(`/v1/matches/${matchId}/like`, {}, viewer.client.csrfHeaders());
    let rows = await interactionsOf(viewer.userId);
    expect(rows.map((r) => r.type)).toEqual(['like']);

    await viewer.client.post(`/v1/matches/${matchId}/pass`, {}, viewer.client.csrfHeaders());
    rows = await interactionsOf(viewer.userId);
    expect(rows.map((r) => r.type)).toEqual(['pass']);

    // pass → like un-suppresses for future batches (flip back).
    await viewer.client.post(`/v1/matches/${matchId}/like`, {}, viewer.client.csrfHeaders());
    rows = await interactionsOf(viewer.userId);
    expect(rows.map((r) => r.type)).toEqual(['like']);
  });

  it('entitlement caps: daily like limit (2) and shortlist limit (2)', async () => {
    const viewer = await mkUser();
    const c1 = await mkUser();
    const c2 = await mkUser();
    const c3 = await mkUser();
    const m1 = (await publishMatch(viewer.userId, c1.userId, 1)).id;
    const m2 = (await publishMatch(viewer.userId, c2.userId, 2)).id;
    const m3 = (await publishMatch(viewer.userId, c3.userId, 3)).id;

    expect((await viewer.client.post(`/v1/matches/${m1}/like`, {}, viewer.client.csrfHeaders())).status).toBe(200);
    expect((await viewer.client.post(`/v1/matches/${m2}/like`, {}, viewer.client.csrfHeaders())).status).toBe(200);
    // Third distinct like in the UTC day breaches the cap (403).
    expect((await viewer.client.post(`/v1/matches/${m3}/like`, {}, viewer.client.csrfHeaders())).status).toBe(403);
    // Idempotent repeats never consume entitlement budget.
    expect((await viewer.client.post(`/v1/matches/${m1}/like`, {}, viewer.client.csrfHeaders())).status).toBe(200);

    expect((await viewer.client.post(`/v1/matches/${m1}/shortlist`, {}, viewer.client.csrfHeaders())).status).toBe(200);
    expect((await viewer.client.post(`/v1/matches/${m2}/shortlist`, {}, viewer.client.csrfHeaders())).status).toBe(200);
    expect((await viewer.client.post(`/v1/matches/${m3}/shortlist`, {}, viewer.client.csrfHeaders())).status).toBe(403);
    // shortlist does NOT mark the feed row acted (only like/pass do).
    const row = await admin.dailyMatch.findFirst({ where: { id: m1 } });
    expect(row?.status).toBe('acted'); // m1 was liked above
    const row3 = await admin.dailyMatch.findFirst({ where: { id: m3 } });
    expect(row3?.status).toBe('published');
  });

  it('pass suppresses future appearances (retrieval no longer returns the candidate)', async () => {
    const viewer = await mkUser();
    const keep = await mkUser();
    const drop = await mkUser();
    const { id: matchId } = await publishMatch(viewer.userId, drop.userId, 1);

    // Observe the batch path directly: the A4 get_candidates tool caps at
    // top-30, which is flaky under the shared test DB (other specs seed
    // embedded users). Retrieval itself is the surface the pass predicate
    // changes, and topK 1000 covers every seeded user.
    const matching = t.app.get(MatchingService);
    const idsBefore = (await matching.retrieveCandidates(viewer.userId, { topK: 1000 })).map(
      (c) => c.userId,
    );
    expect(idsBefore).toContain(keep.userId);
    expect(idsBefore).toContain(drop.userId);

    await viewer.client.post(`/v1/matches/${matchId}/pass`, {}, viewer.client.csrfHeaders());

    const idsAfter = (await matching.retrieveCandidates(viewer.userId, { topK: 1000 })).map(
      (c) => c.userId,
    );
    expect(idsAfter).toContain(keep.userId);
    expect(idsAfter).not.toContain(drop.userId);
  });
});
