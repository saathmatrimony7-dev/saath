/**
 * Retrieval + pre-rank tests (P3-04, DESIGN.md §8 steps 3-5):
 * - retrieveCandidates: known cosine ordering (unit axes / 45° mix), users
 *   without embedding excluded, ineligible users excluded even with perfect
 *   vectors, missing caller embedding → EmbeddingMissingError, topK respected
 * - HNSW index exists; ANN top-10 recall vs exact brute force ≥ 0.9 on
 *   ≥50 synthetic vectors (HNSW default params at this scale are ~1.0)
 * - parseVectorText roundtrip (unit + from the DB's textual form)
 * - preRankCandidates / rankCandidates: weight ordering (similarity, tier,
 *   activity, rule signals), reciprocity drop, output shape, topN respected
 * - applyExposureCap: pure function, at-cap removed, under-cap kept,
 *   empty map no-op
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, signupTestUser, type TestApp } from '../helpers/test-app';
import type { TestClient } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { seedTaxonomy } from '../../prisma/seed-taxonomy-runner';
import {
  MatchingService,
  EmbeddingMissingError,
  parseVectorText,
  activityScore,
} from '../../src/modules/matching/matching.service';

let t: TestApp;
let admin: RlsPrismaClient;
let matching: MatchingService;
let seq = 0;

const REF_YEAR = new Date().getFullYear();
const DIM = 1024;

const DEFAULT_PROFILE = {
  cityId: 'mumbai',
  diet: 'veg',
  heightCm: 170,
  maritalStatus: 'never_married',
  willingToRelocate: true,
  religionId: 'hindu',
  communityId: 'hindu-brahmin',
};

const Z = () => new Array<number>(DIM).fill(0);
/** Unit axis e_i (exactly representable in float4). */
const axis = (i: number) => {
  const v = Z();
  v[i] = 1;
  return v;
};
/** Normalised blend of two axes (a·e_i + b·e_j)/norm. */
const blend = (i: number, a: number, j: number, b: number) => {
  const n = Math.hypot(a, b);
  return Z().map((_, k) => (k === i ? a / n : k === j ? b / n : 0));
};
const negate = (v: number[]) => v.map((x) => -x);

/** Deterministic pseudo-random unit vector (LCG, seeded). */
function randUnit(seed: number): number[] {
  let s = seed >>> 0;
  const next = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const v = Array.from({ length: DIM }, () => next() * 2 - 1);
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

/** Cosine similarity between equal-length vectors. */
const cosine = (a: number[], b: number[]) => {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
};

interface MkOpts {
  profile?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  tier?: number;
  lastActiveDaysAgo?: number;
}

/** Verified user with profile + approved photo (+ optional prefs/embedding). */
async function mkUser(o: MkOpts = {}): Promise<{ client: TestClient; userId: string }> {
  seq += 1;
  const { client, userId } = await signupTestUser(t, `+9177${String(seq).padStart(8, '0')}`);
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
  await admin.user.update({
    where: { id: userId },
    data: {
      ageVerified: true,
      birthYear: REF_YEAR - 28,
      status: 'active',
      ...(o.lastActiveDaysAgo !== undefined
        ? { lastActiveAt: new Date(Date.now() - o.lastActiveDaysAgo * 86_400_000) }
        : {}),
    },
  });
  await admin.profile.update({
    where: { userId },
    data: { verificationTier: o.tier ?? 1 },
  });
  await admin.photo.create({
    data: {
      userId,
      storageKey: `retr-${userId}`,
      contentType: 'image/jpeg',
      moderationStatus: 'approved',
    },
  });
  return { client, userId };
}

/** Write an embedding via admin raw SQL (numeric-only vector literal). */
async function setEmbedding(userId: string, vector: number[]): Promise<void> {
  expect(vector.length).toBe(DIM);
  const literal = `[${vector.join(',')}]`;
  await admin.$executeRawUnsafe(
    `UPDATE "profiles" SET "embedding" = '${literal}'::vector WHERE "user_id" = $1::uuid`,
    userId,
  );
}

/** Read an embedding back as pgvector text. */
async function readEmbeddingText(userId: string): Promise<string> {
  const rows = await admin.$queryRaw<{ emb: string | null }[]>`
    SELECT "embedding"::text AS emb FROM "profiles" WHERE "user_id" = ${userId}::uuid`;
  return rows[0]?.emb ?? '';
}

/** All eligible-embedded users created in THIS spec, userId → stored vector. */
const embedded = new Map<string, number[]>();

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

describe('parseVectorText', () => {
  it('parses the pgvector [..] text form; rejects malformed input', () => {
    expect(parseVectorText('[1,0.5,-2]')).toEqual([1, 0.5, -2]);
    expect(parseVectorText('[ 1 , 2 ,3 ]', 3)).toEqual([1, 2, 3]);
    expect(() => parseVectorText('nope')).toThrow();
    expect(() => parseVectorText('[1,2')).toThrow();
    expect(() => parseVectorText('[1,2]x')).toThrow();
    expect(() => parseVectorText('[a,b]')).toThrow();
    expect(() => parseVectorText('[]')).toThrow();
    expect(() => parseVectorText('[1,2]', 3)).toThrow(); // dim mismatch
  });

  it('roundtrips a stored embedding through the DB textual form', async () => {
    const u = await mkUser();
    const original = blend(0, 1, 1, 1);
    await setEmbedding(u.userId, original);
    const text = await readEmbeddingText(u.userId);
    const parsed = parseVectorText(text, DIM);
    expect(parsed.length).toBe(DIM);
    for (let i = 0; i < DIM; i++) {
      expect(parsed[i]).toBeCloseTo(Math.fround(original[i] ?? 0), 6);
    }
  });
});

describe('activityScore', () => {
  it('buckets recency: ≤7d → 1.0, ≤30d → 0.6, ≤90d → 0.3, else/null → 0.1', () => {
    const now = new Date('2026-10-25T00:00:00Z');
    const days = (d: number) => new Date(now.getTime() - d * 86_400_000);
    expect(activityScore(days(0), now)).toBe(1.0);
    expect(activityScore(days(7), now)).toBe(1.0);
    expect(activityScore(days(8), now)).toBe(0.6);
    expect(activityScore(days(30), now)).toBe(0.6);
    expect(activityScore(days(31), now)).toBe(0.3);
    expect(activityScore(days(90), now)).toBe(0.3);
    expect(activityScore(days(91), now)).toBe(0.1);
    expect(activityScore(days(500), now)).toBe(0.1);
    expect(activityScore(null, now)).toBe(0.1);
  });
});

describe('retrieveCandidates', () => {
  it('returns candidates in known cosine order; excludes no-embedding users', async () => {
    const caller = await mkUser();
    await setEmbedding(caller.userId, axis(0));

    const same = await mkUser();
    const mix = await mkUser(); // 45° from e0
    const orth = await mkUser(); // 90° from e0
    const neg = await mkUser(); // 180° from e0
    const noEmb = await mkUser(); // eligible but no embedding
    await setEmbedding(same.userId, axis(0));
    await setEmbedding(mix.userId, blend(0, 1, 1, 1));
    await setEmbedding(orth.userId, axis(1));
    await setEmbedding(neg.userId, negate(axis(0)));
    for (const [id, v] of [
      [same.userId, axis(0)],
      [mix.userId, blend(0, 1, 1, 1)],
      [orth.userId, axis(1)],
      [neg.userId, negate(axis(0))],
    ] as const) {
      embedded.set(id, v);
    }

    const res = await matching.retrieveCandidates(caller.userId);
    const ids = res.map((r) => r.userId);
    expect(ids).not.toContain(noEmb.userId);
    expect(ids).not.toContain(caller.userId);
    // Known cosine-distance order (`<=>` = 1 − cos):
    //   d(e0,e0)=0 < d(e0,45°)=1−√2/2≈0.293 < d(e0,e1)=1 < d(e0,−e0)=2
    const pos = (u: string) => ids.indexOf(u);
    expect(pos(same.userId)).toBeGreaterThanOrEqual(0);
    expect(pos(same.userId)).toBeLessThan(pos(mix.userId));
    expect(pos(mix.userId)).toBeLessThan(pos(orth.userId));
    expect(pos(orth.userId)).toBeLessThan(pos(neg.userId));
    expect(res[pos(same.userId)]?.distance).toBeCloseTo(0, 6);
    expect(res[pos(mix.userId)]?.distance).toBeCloseTo(1 - Math.SQRT1_2, 4);
    expect(res[pos(orth.userId)]?.distance).toBeCloseTo(1, 6);
  });

  it('respects topK', async () => {
    const caller = await mkUser();
    await setEmbedding(caller.userId, axis(0));
    const res = await matching.retrieveCandidates(caller.userId, { topK: 2 });
    expect(res.length).toBeLessThanOrEqual(2);
    expect(res.length).toBeGreaterThan(0);
    // The exact-match axis user from the previous test is the nearest row.
    expect(res[0]?.distance).toBeCloseTo(0, 6);
    await expect(matching.retrieveCandidates(caller.userId, { topK: 0 })).rejects.toThrow();
  });

  it('excludes ineligible users (tier 0) even with a perfect vector', async () => {
    const caller = await mkUser();
    await setEmbedding(caller.userId, axis(0));
    const tier0 = await mkUser({ tier: 0 });
    await setEmbedding(tier0.userId, axis(0)); // would rank #1 if eligible
    const ids = (await matching.retrieveCandidates(caller.userId)).map((r) => r.userId);
    expect(ids).not.toContain(tier0.userId);
  });

  it('throws EmbeddingMissingError when the caller has no embedding', async () => {
    const caller = await mkUser(); // no setEmbedding call
    await expect(matching.retrieveCandidates(caller.userId)).rejects.toThrow(EmbeddingMissingError);
    await expect(matching.retrieveCandidates(caller.userId)).rejects.toMatchObject({
      code: 'EMBEDDING_MISSING',
    });
  });

  it('the HNSW index exists (pg_indexes)', async () => {
    const rows = await admin.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'profiles' AND indexname = 'profiles_embedding_hnsw_idx'`,
    );
    expect(rows.length).toBe(1);
  });
});

describe('ANN recall vs brute force', () => {
  it('top-10 recall ≥ 0.9 against exact cosine ranking (≥50 vectors)', async () => {
    const caller = await mkUser();
    const query = randUnit(42);
    await setEmbedding(caller.userId, query);
    embedded.set(caller.userId, query);

    // 52 synthetic candidates with deterministic pseudo-random unit vectors.
    for (let i = 0; i < 52; i++) {
      const u = await mkUser();
      const v = randUnit(1000 + i);
      await setEmbedding(u.userId, v);
      embedded.set(u.userId, v);
    }

    // Brute force over every eligible embedded user in this spec file, using
    // the float4-rounded values (pgvector stores float4 = Math.fround).
    const brute = [...embedded.entries()]
      .filter(([id]) => id !== caller.userId)
      .map(([userId, v]) => ({
        userId,
        sim: cosine(query.map(Math.fround), v.map(Math.fround)),
      }))
      .sort((a, b) => b.sim - a.sim || (a.userId < b.userId ? -1 : 1));
    const bruteTop10 = brute.slice(0, 10).map((b) => b.userId);

    const ann = await matching.retrieveCandidates(caller.userId, { topK: 50 });
    const annTop10 = ann.slice(0, 10).map((r) => r.userId);
    const overlap = annTop10.filter((id) => bruteTop10.includes(id)).length;
    expect(overlap / 10).toBeGreaterThanOrEqual(0.9);
  });
});

describe('preRankCandidates / rankCandidates', () => {
  it('weights produce the expected ordering; reciprocity drop works', async () => {
    const caller = await mkUser();
    await setEmbedding(caller.userId, axis(0));

    // A: identical vector, all declared fields match → sim 1, rule 3/3.
    const a = await mkUser();
    await setEmbedding(a.userId, axis(0));
    // B: orthogonal vector, declared fields match → sim 0.25, rule 3/3.
    const b = await mkUser();
    await setEmbedding(b.userId, axis(1));
    // C: identical vector, tier 3 (beats A on verification weight).
    const c = await mkUser({ tier: 3 });
    await setEmbedding(c.userId, axis(0));
    // D: identical vector, inactive 200 days (loses activity weight).
    const d = await mkUser({ lastActiveDaysAgo: 200 });
    await setEmbedding(d.userId, axis(0));
    // E: identical vector, declared fields all differ (loses rule weight).
    const e = await mkUser({
      profile: { cityId: 'delhi', diet: 'non_veg', religionId: 'muslim', communityId: 'muslim-sunni' },
    });
    await setEmbedding(e.userId, axis(0));
    // X: would rank, but its own preferences exclude the caller (reciprocity).
    const x = await mkUser({ preferences: { ageMin: 95 } });
    await setEmbedding(x.userId, axis(2));

    const ranked = await matching.rankCandidates(caller.userId, { topK: 200, topN: 200 });
    const ids = ranked.map((r) => r.userId);
    const idx = (u: string) => ids.indexOf(u);
    const row = (u: string) => ranked.find((r) => r.userId === u);

    // Reciprocity drop: X's ageMin excludes the caller → absent.
    expect(ids).not.toContain(x.userId);

    // Similarity component per spec: (1 − dist)/2.
    // A (dist 0 → sim 0.5) beats B (dist 1 → sim 0).
    expect(row(a.userId)?.similarity).toBeCloseTo(0.5, 6);
    expect(row(b.userId)?.similarity).toBeCloseTo(0, 6);
    expect(idx(a.userId)).toBeGreaterThanOrEqual(0);
    expect(idx(a.userId)).toBeLessThan(idx(b.userId));

    // Verification weight: C (tier 3, score 0.75) beats A (tier 1, score 0.65).
    expect(idx(c.userId)).toBeLessThan(idx(a.userId));
    expect(row(c.userId)?.score).toBeGreaterThan(row(a.userId)?.score ?? 0);

    // Activity weight: A (recent) beats D (200 days inactive).
    expect(idx(a.userId)).toBeLessThan(idx(d.userId));

    // Rule weight: A (all declared fields match) beats E (none match).
    expect(idx(a.userId)).toBeLessThan(idx(e.userId));
    expect(row(a.userId)?.signals).toEqual({ sameCity: true, sameDiet: true, sameCommunity: true });
    expect(row(e.userId)?.signals).toEqual({
      sameCity: false,
      sameDiet: false,
      sameCommunity: false,
    });
  });

  it('output rows carry score/similarity/signals/closed-vocab reasonCodes; topN respected', async () => {
    const caller = await mkUser();
    await setEmbedding(caller.userId, axis(0));
    const n = await matching.rankCandidates(caller.userId, { topK: 200, topN: 5 });
    expect(n.length).toBeLessThanOrEqual(5);
    expect(n.length).toBeGreaterThan(0);
    for (const r of n) {
      expect(typeof r.score).toBe('number');
      expect(r.similarity).toBeGreaterThanOrEqual(0);
      expect(r.similarity).toBeLessThanOrEqual(1);
      expect(Object.keys(r.signals).sort()).toEqual(['sameCity', 'sameCommunity', 'sameDiet']);
      expect(Array.isArray(r.reasonCodes)).toBe(true);
      for (const code of r.reasonCodes) {
        expect(/^[A-Z_]+$/.test(code)).toBe(true); // closed vocabulary, no free text
      }
    }
  });
});

describe('applyExposureCap', () => {
  it('removes at-cap candidates, keeps under-cap and unseen; empty map is a no-op', () => {
    const cands = [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }];
    const shown = new Map([
      ['u1', 5], // at default cap (5) → removed
      ['u2', 4], // under cap → kept
    ]);
    const out = matching.applyExposureCap(cands, shown);
    expect(out.map((c) => c.userId)).toEqual(['u2', 'u3']);

    // Empty map: no-op.
    expect(matching.applyExposureCap(cands, new Map()).length).toBe(3);

    // Explicit cap overrides the config default (count ≥ cap → removed).
    expect(matching.applyExposureCap(cands, new Map([['u1', 2]]), 2).map((c) => c.userId)).toEqual([
      'u2',
      'u3',
    ]);
    expect(matching.applyExposureCap(cands, new Map([['u1', 1]]), 2).map((c) => c.userId)).toEqual([
      'u1',
      'u2',
      'u3',
    ]);
    expect(() => matching.applyExposureCap(cands, shown, 0)).toThrow();
  });
});
