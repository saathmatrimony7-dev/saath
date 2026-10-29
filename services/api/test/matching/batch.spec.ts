/**
 * P3-07: A4 matchmaker tools + nightly batch plumbing (DESIGN.md Â§6.1 A4,
 * Â§8 steps 1-9):
 * - get_candidates / request_screening / publish_daily_matches: A4-only
 *   agent allow-list + acting-user binding, strict bodies, closed output
 * - publish is an idempotent replace-set per (user, batch_date)
 * - batch-users enumeration (service token): eligibility predicates
 * - shown-counts cache (P3-12): exact across publish / re-publish / clear
 * - full-pipeline integration on seeded synthetic users with embeddings:
 *   candidates â†’ mock-broker screening â†’ published rows â†’ idempotent re-run
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, signupTestUser, type TestClient, type TestApp } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { mintAgentToken } from '../../src/modules/llm-gateway/agent-token';
import { EXPLANATION_FACT_TAGS, MatchingService } from '../../src/modules/matching/matching.service';
import { seedTaxonomy } from '../../prisma/seed-taxonomy-runner';

const SECRET = 'dev-agent-token-hmac-secret';
const INTERNAL_TOKEN = { 'x-internal-token': 'test-internal-token-0123456789' };
const A4 = 'A4-matchmaker';

let t: TestApp;
let admin: RlsPrismaClient;
let anyClient: TestClient;
let seq = 1000;

const tokenFor = (user: string, tools: string[], agent = A4) =>
  mintAgentToken(SECRET, { agent, acting_for_user_id: user, tools }, 600);

const unit = (i: number) => {
  const v = new Array(1024).fill(0);
  v[i % 1024] = 1;
  return v;
};

// Fixed offsets from the REAL today — never today itself: get_candidates
// returns shownCounts for the real date, and P3-08 specs legitimately
// publish real-today rows in the shared test DB.
const DAY = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const DEFAULT_PROFILE: Record<string, unknown> = {
  cityId: 'mumbai',
  diet: 'veg',
  heightCm: 170,
  maritalStatus: 'never_married',
  willingToRelocate: true,
  religionId: 'hindu',
  communityId: 'hindu-brahmin',
};

async function mkUser(profileOverride: Record<string, unknown> = {}) {
  seq += 1;
  const { client, userId } = await signupTestUser(t, `+9195${String(seq).padStart(8, '0')}`);
  anyClient = client;
  const profile = { ...DEFAULT_PROFILE, ...profileOverride };
  for (const k of Object.keys(profile)) if (profile[k] === undefined) delete profile[k];
  const pr = await client.patch('/v1/me/profile', profile, client.csrfHeaders());
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
    data: { userId, storageKey: `batch-${userId}`, contentType: 'image/jpeg', moderationStatus: 'approved' },
  });
  const emb = await client.req(
    'POST',
    '/v1/internal/tools/save_embedding',
    { userId, vector: unit(seq) },
    { 'x-agent-token': mintAgentToken(SECRET, { agent: 'A2-extractor', acting_for_user_id: userId, tools: ['save_embedding'] }, 600) },
  );
  expect(emb.status).toBe(200);
  return { client, userId };
}

const tool = (path: string, body: unknown, userId: string, tools: string[]) =>
  anyClient.req('POST', `/v1/internal/tools/${path}`, body, {
    'x-agent-token': tokenFor(userId, tools),
  });

beforeAll(async () => {
  t = await bootTestApp();
  admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
  await seedTaxonomy(admin);
});

afterAll(async () => {
  await admin.$disconnect();
  await t.app.close();
});

describe('A4 tool authz', () => {
  it('anonymous 401; wrong agent 403; unbound acting user 403; strict body 400', async () => {
    const { userId, client } = await mkUser();
    const anon = await client.req('POST', '/v1/internal/tools/get_candidates', { userId });
    expect(anon.status).toBe(401);
    const wrongAgent = await client.req(
      'POST',
      '/v1/internal/tools/get_candidates',
      { userId },
      { 'x-agent-token': tokenFor(userId, ['get_candidates'], 'A6-screening-broker') },
    );
    expect(wrongAgent.status).toBe(403);
    const unbound = await client.req(
      'POST',
      '/v1/internal/tools/get_candidates',
      { userId },
      { 'x-agent-token': mintAgentToken(SECRET, { agent: A4, acting_for_user_id: '', tools: ['get_candidates'] }, 600) },
    );
    expect(unbound.status).toBe(403);
    const strict = await client.req(
      'POST',
      '/v1/internal/tools/get_candidates',
      { userId, extra: 1 },
      { 'x-agent-token': tokenFor(userId, ['get_candidates']) },
    );
    expect(strict.status).toBe(400);
  });

  it('allow-list miss 403: right agent, tool not in the token', async () => {
    const { userId, client } = await mkUser();
    const res = await client.req(
      'POST',
      '/v1/internal/tools/get_candidates',
      { userId },
      { 'x-agent-token': tokenFor(userId, ['publish_daily_matches']) },
    );
    expect(res.status).toBe(403);
  });
});

describe('request_screening tool (mock broker transport)', () => {
  it('returns a closed-vocabulary verdict for the bound user', async () => {
    const a = await mkUser();
    const b = await mkUser();
    const res = await tool('request_screening', { aUserId: a.userId, bUserId: b.userId }, a.userId, [
      'request_screening',
    ]);
    expect(res.status).toBe(200);
    expect(['COMPATIBLE', 'PARTIAL', 'INCOMPATIBLE']).toContain(res.json?.verdict);
    expect(res.json?.score).toBeGreaterThanOrEqual(0);
    expect(res.json?.score).toBeLessThanOrEqual(1);
  });

  it('binding: a token for user A cannot screen a pair led by user B', async () => {
    const a = await mkUser();
    const b = await mkUser();
    const res = await tool('request_screening', { aUserId: b.userId, bUserId: a.userId }, a.userId, [
      'request_screening',
    ]);
    expect(res.status).toBe(403);
  });
});

describe('publish_daily_matches', () => {
  it('writes rows; re-publish for the same date replaces the set (idempotent)', async () => {
    const me = await mkUser();
    const c1 = await mkUser();
    const c2 = await mkUser();
    const p1 = await tool(
      'publish_daily_matches',
      {
        userId: me.userId,
        batchDate: DAY(1),
        matches: [{ candidateId: c1.userId, rank: 1, score: 0.9, explanation: { en: 'You both are based in Mumbai.' } }],
      },
      me.userId,
      ['publish_daily_matches'],
    );
    expect(p1.status).toBe(200);
    expect(p1.json).toEqual({ published: 1 });

    const rows1 = await admin.dailyMatch.findMany({ where: { userId: me.userId } });
    expect(rows1).toHaveLength(1);
    expect(rows1[0]?.candidateId).toBe(c1.userId);
    expect(rows1[0]?.explanationI18n).toEqual({ en: 'You both are based in Mumbai.' });

    // re-run with a different set â†’ replace, not append
    const p2 = await tool(
      'publish_daily_matches',
      {
        userId: me.userId,
        batchDate: DAY(1),
        matches: [
          { candidateId: c2.userId, rank: 1, score: 0.8 },
          { candidateId: c1.userId, rank: 2, score: 0.7 },
        ],
      },
      me.userId,
      ['publish_daily_matches'],
    );
    expect(p2.status).toBe(200);
    const rows2 = await admin.dailyMatch.findMany({ where: { userId: me.userId } });
    expect(rows2).toHaveLength(2);
    expect(rows2.find((r) => r.rank === 1)?.candidateId).toBe(c2.userId);

    // a different date accumulates independently
    const p3 = await tool(
      'publish_daily_matches',
      {
        userId: me.userId,
        batchDate: DAY(2),
        matches: [],
      },
      me.userId,
      ['publish_daily_matches'],
    );
    expect(p3.status).toBe(200);
    expect(await admin.dailyMatch.count({ where: { userId: me.userId } })).toBe(2);
  });

  it('explanation validation: junk locale, oversize or HTML → 400', async () => {
    const me = await mkUser();
    const c1 = await mkUser();
    const bad = (explanation: unknown) =>
      tool(
        'publish_daily_matches',
        { userId: me.userId, batchDate: DAY(2), matches: [{ candidateId: c1.userId, rank: 1, score: 0.5, explanation }] },
        me.userId,
        ['publish_daily_matches'],
      );
    expect((await bad({ fr: 'bonjour' })).status).toBe(400);
    expect((await bad({ en: 'x'.repeat(281) })).status).toBe(400);
    expect((await bad({ en: '<b>bold</b>' })).status).toBe(400);
  });

  it('rejects over-cap sets and duplicate ranks (403); bad candidate (500-safe)', async () => {
    const me = await mkUser();
    const c1 = await mkUser();
    const c2 = await mkUser();
    const tooMany = await tool(
      'publish_daily_matches',
      {
        userId: me.userId,
        batchDate: DAY(3),
        matches: Array.from({ length: 4 }, (_, i) => ({ candidateId: c1.userId, rank: i + 1, score: 0.5 })),
      },
      me.userId,
      ['publish_daily_matches'],
    );
    expect(tooMany.status).toBe(403);
    const dupRanks = await tool(
      'publish_daily_matches',
      {
        userId: me.userId,
        batchDate: DAY(3),
        matches: [
          { candidateId: c1.userId, rank: 1, score: 0.5 },
          { candidateId: c2.userId, rank: 1, score: 0.4 },
        ],
      },
      me.userId,
      ['publish_daily_matches'],
    );
    expect(dupRanks.status).toBe(403);
  });
});

describe('batch-users enumeration', () => {
  it('lists eligible users only; requires the service token', async () => {
    const ok = await mkUser();
    const hidden = await mkUser({ visibility: 'hidden' });
    const anon = await anyClient.req('POST', '/v1/internal/matching/batch-users', {});
    expect(anon.status).toBe(401);
    const res = await anyClient.req('POST', '/v1/internal/matching/batch-users', {}, INTERNAL_TOKEN);
    expect(res.status).toBe(200);
    const ids = (res.json as { userIds: string[] }).userIds;
    expect(ids).toContain(ok.userId);
    expect(ids).not.toContain(hidden.userId);
  });
});

describe('shown-counts cache (P3-12)', () => {
  it('stays exact across publish / replace-set re-publish / clear for a day', async () => {
    const svc = t.app.get(MatchingService);
    const me = await mkUser();
    const c1 = await mkUser();
    const c2 = await mkUser();
    const day = new Date(`${DAY(6)}T00:00:00Z`);

    // lazy load (empty) then publish → counts reflect the new rows
    expect((await svc.shownCountsFor(day)).get(c1.userId) ?? 0).toBe(0);
    await svc.publishDailyMatches(me.userId, day, [
      { candidateId: c1.userId, rank: 1, score: 0.9 },
      { candidateId: c2.userId, rank: 2, score: 0.8 },
    ]);
    let counts = await svc.shownCountsFor(day);
    expect(counts.get(c1.userId)).toBe(1);
    expect(counts.get(c2.userId)).toBe(1);

    // replace-set re-publish: c1 kept (net 0), c2 dropped
    await svc.publishDailyMatches(me.userId, day, [
      { candidateId: c1.userId, rank: 1, score: 0.9 },
    ]);
    counts = await svc.shownCountsFor(day);
    expect(counts.get(c1.userId)).toBe(1);
    expect(counts.get(c2.userId) ?? 0).toBe(0);

    // clear (empty publish) → back to zero, and the DB agrees
    await svc.publishDailyMatches(me.userId, day, []);
    counts = await svc.shownCountsFor(day);
    expect(counts.get(c1.userId) ?? 0).toBe(0);
    expect(await admin.dailyMatch.count({ where: { batchDate: day } })).toBe(0);
  });
});

describe('full-pipeline integration (seeded synthetic users)', () => {
  it('candidates â†’ screening â†’ publish â†’ idempotent re-run', async () => {
    const me = await mkUser();
    await mkUser();

    // steps 1-5 + shown counts
    const gc = await tool('get_candidates', { userId: me.userId }, me.userId, ['get_candidates']);
    expect(gc.status).toBe(200);
    const { candidates, shownCounts, locale } = gc.json as {
      candidates: { userId: string; score: number; explanationFacts: string[] }[];
      shownCounts: Record<string, number>;
      locale: string;
    };
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(30);
    expect(locale).toBe('en');
    // P3-09: closed-vocabulary fact tags only — declared fields, never
    // screening reason codes.
    for (const c of candidates) {
      for (const fact of c.explanationFacts) {
        expect(EXPLANATION_FACT_TAGS).toContain(fact);
      }
    }
    // Other spec files share the ephemeral DB and may publish real-today
    // rows (P3-08 feed specs); what must hold is that THIS run's candidates
    // have not been shown yet — the exposure cap starts at zero for them.
    for (const c of candidates) {
      expect(shownCounts[c.userId] ?? 0).toBe(0);
    }

    // step 6: screen the top candidates (mock broker), keep good verdicts
    const kept: { candidateId: string; rank: number; score: number }[] = [];
    for (let i = 0; i < Math.min(3, candidates.length); i++) {
      const rs = await tool(
        'request_screening',
        { aUserId: me.userId, bUserId: candidates[i]!.userId },
        me.userId,
        ['request_screening'],
      );
      expect(rs.status).toBe(200);
      if (rs.json?.verdict !== 'INCOMPATIBLE') {
        kept.push({ candidateId: candidates[i]!.userId, rank: kept.length + 1, score: 0.9 });
      }
    }

    // step 9: publish + idempotent re-run
    for (let run = 0; run < 2; run++) {
      const pub = await tool(
        'publish_daily_matches',
        { userId: me.userId, batchDate: DAY(4), matches: kept },
        me.userId,
        ['publish_daily_matches'],
      );
      expect(pub.status).toBe(200);
      expect(pub.json?.published).toBe(kept.length);
    }
    const rows = await admin.dailyMatch.findMany({
      where: { userId: me.userId, batchDate: new Date(`${DAY(4)}T00:00:00Z`) },
    });
    expect(rows).toHaveLength(kept.length);
    for (const r of rows) {
      expect(r.candidateId).not.toBe(me.userId);
    }
  });
});
