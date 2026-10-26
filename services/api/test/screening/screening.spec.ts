/**
 * P3-05: A5/A6 screening broker — Core half (DESIGN.md §7 + exit criterion 1).
 * - get_preference_snapshot: redacted view = enums + A2-normalised stances
 *   ONLY; strict schema; A6-only agent allow-list; 404 discipline
 * - EXIT CRITERION 1: schema-level proof that no free-text field exists in
 *   the snapshot, + end-to-end canary test that raw user text (onboarding
 *   transcript, display name, about text) cannot cross into the snapshot
 * - write_screening_result: closed-vocab reason codes, pinned model version,
 *   hash-bound inputs (409 on snapshot/inputs hash mismatch), pref versions
 *   taken from the DB, upsert per normalised pair
 * - find-cached: miss → write → hit; invalidated by preference-version
 *   change and by expiry
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import { bootTestApp, signupTestUser, type TestClient, type TestApp } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { mintAgentToken } from '../../src/modules/llm-gateway/agent-token';
import {
  redactedSnapshotSchema,
  STANCE_MAX_CHARS,
  TOPIC_MAX_CHARS,
} from '../../src/modules/screening/screening.dto';
import {
  snapshotHash,
  inputsHash,
  normalizePair,
  canonicalJson,
} from '../../src/modules/screening/screening.service';

const SECRET = 'dev-agent-token-hmac-secret';
const INTERNAL_TOKEN = { 'x-internal-token': 'test-internal-token-0123456789' };
const RULES_VERSION = 'screening-rules-v2';
const MODEL_VERSION = 'a6-screen-v2';

let t: TestApp;
let admin: RlsPrismaClient;
let anyClient: TestClient;
let seq = 0;

const A6 = 'A6-screening-broker';
const tokenFor = (tools: string[], agent = A6, actingFor = '') =>
  mintAgentToken(SECRET, { agent, acting_for_user_id: actingFor, tools }, 600);

const CANARY_TRANSCRIPT = 'CANARY-TRANSCRIPT-9f3a1b7c55d2';
const CANARY_NAME = 'CANARY-NAME-4e8f0a6b3d1c';
const CANARY_ABOUT = 'CANARY-ABOUT-7c2e9a5f1b8d';

interface MkOpts {
  profile?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  stances?: { topic: string; stance: string; weight?: number }[];
}

async function mkUser(o: MkOpts = {}): Promise<{ client: TestClient; userId: string }> {
  seq += 1;
  const { client, userId } = await signupTestUser(t, `+9197${String(seq).padStart(8, '0')}`);
  const csrf = client.csrfHeaders();
  const profile: Record<string, unknown> = {
    diet: 'veg',
    maritalStatus: 'never_married',
    hasChildren: false,
    willingToRelocate: true,
    ...o.profile,
  };
  for (const k of Object.keys(profile)) if (profile[k] === undefined) delete profile[k];
  const pr = await client.patch('/v1/me/profile', profile, csrf);
  expect(pr.status, `profile patch: ${JSON.stringify(pr.json)}`).toBe(200);
  const pp = await client.put(
    '/v1/me/preferences',
    { relocateOk: true, dietOk: ['veg'], maritalOk: ['never_married'], ...o.preferences },
    csrf,
  );
  expect(pp.status, `preferences put: ${JSON.stringify(pp.json)}`).toBe(200);
  for (const s of o.stances ?? []) {
    await admin.softPreference.create({
      data: { userId, topic: s.topic, stanceNormalised: s.stance, weight: s.weight ?? 50 },
    });
  }
  return { client, userId };
}

interface SnapshotResponse {
  snapshot: unknown;
  snapshotHash: string;
  prefVersion: number;
  profileVersion: number;
  rulesVersion: string;
  modelVersion: string;
}

async function snapshotOf(userId: string): Promise<SnapshotResponse> {
  const res = await anyClient.req(
    'POST',
    '/v1/internal/tools/get_preference_snapshot',
    { userId },
    { 'x-agent-token': tokenFor(['get_preference_snapshot']) },
  );
  expect(res.status).toBe(200);
  return res.json as unknown as SnapshotResponse;
}

/** Hashes must attach to the NORMALISED pair (user_a < user_b), like Core. */
function hashBundle(a: SnapshotResponse, b: SnapshotResponse) {
  const hashOf = new Map<string, string>([
    [(a.snapshot as { userId: string }).userId, a.snapshotHash],
    [(b.snapshot as { userId: string }).userId, b.snapshotHash],
  ]);
  const [userA, userB] = normalizePair(
    (a.snapshot as { userId: string }).userId,
    (b.snapshot as { userId: string }).userId,
  );
  const snapshotHashA = hashOf.get(userA)!;
  const snapshotHashB = hashOf.get(userB)!;
  return {
    snapshotHashA,
    snapshotHashB,
    inputsHash: inputsHash(snapshotHashA, snapshotHashB, RULES_VERSION),
  };
}

beforeAll(async () => {
  t = await bootTestApp();
  admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
});

afterAll(async () => {
  await admin.$disconnect();
  await t.app.close();
});

describe('get_preference_snapshot (redacted view)', () => {
  it('returns enums + normalised stances + share level with provenance', async () => {
    const { userId } = await mkUser({
      stances: [
        { topic: 'career_after_marriage', stance: 'Wants to keep working after marriage', weight: 80 },
      ],
    });
    anyClient = (await mkUser({})).client;
    const body = await snapshotOf(userId);
    const snap = body.snapshot as Record<string, unknown>;
    expect(redactedSnapshotSchema.parse(snap)).toBeTruthy();
    expect(snap).toMatchObject({
      userId,
      profileEnums: {
        diet: 'veg',
        maritalStatus: 'never_married',
        hasChildren: false,
        willingToRelocate: true,
      },
      preferences: { relocateOk: true, dietOk: ['veg'], maritalOk: ['never_married'] },
      shareLevel: 'standard',
    });
    expect(snap.softPreferences).toEqual([
      { topic: 'career_after_marriage', stance: 'Wants to keep working after marriage', weight: 80 },
    ]);
    expect(body.prefVersion).toBe(1);
    expect(body.rulesVersion).toBe(RULES_VERSION);
    expect(body.modelVersion).toBe(MODEL_VERSION);
    // hash chain is internally consistent
    expect(body.snapshotHash).toBe(snapshotHash(redactedSnapshotSchema.parse(snap)));
  });

  it('404s for unknown ids (indistinguishable from missing users)', async () => {
    anyClient = (await mkUser({})).client;
    const res = await anyClient.req(
      'POST',
      '/v1/internal/tools/get_preference_snapshot',
      { userId: crypto.randomUUID() },
      { 'x-agent-token': tokenFor(['get_preference_snapshot']) },
    );
    expect(res.status).toBe(404);
  });

  it('anonymous 401; wrong agent 403; allow-list miss 403; strict body 400', async () => {
    const { userId, client } = await mkUser({});
    anyClient = client;
    const noToken = await client.req('POST', '/v1/internal/tools/get_preference_snapshot', { userId });
    expect(noToken.status).toBe(401);
    const wrongAgent = await client.req(
      'POST',
      '/v1/internal/tools/get_preference_snapshot',
      { userId },
      { 'x-agent-token': tokenFor(['get_preference_snapshot'], 'A1-onboarding') },
    );
    expect(wrongAgent.status).toBe(403);
    const allowMiss = await client.req(
      'POST',
      '/v1/internal/tools/get_preference_snapshot',
      { userId },
      { 'x-agent-token': tokenFor(['write_screening_result']) }, // right agent, wrong tool
    );
    expect(allowMiss.status).toBe(403);
    const strict = await client.req(
      'POST',
      '/v1/internal/tools/get_preference_snapshot',
      { userId, extra: 1 },
      { 'x-agent-token': tokenFor(['get_preference_snapshot']) },
    );
    expect(strict.status).toBe(400);
  });

  it('drops over-long or empty stances instead of leaking them', async () => {
    const { userId, client } = await mkUser({
      stances: [
        { topic: 'ok_topic', stance: 'A reasonable normalised stance' },
        { topic: 'huge_topic', stance: 'x'.repeat(STANCE_MAX_CHARS + 1) },
        { topic: 'empty_topic', stance: '' },
      ],
    });
    anyClient = client;
    const body = await snapshotOf(userId);
    const topics = (body.snapshot as { softPreferences: { topic: string }[] }).softPreferences.map(
      (s) => s.topic,
    );
    expect(topics).toEqual(['ok_topic']);
  });
});

describe('exit criterion 1 — no raw user text can cross', () => {
  /**
   * Schema-level proof: walk the snapshot schema and assert every string leaf
   * is either a closed enum, the uuid, or a bounded stance/topic field. No
   * free-text field exists anywhere in the contract.
   */
  it('schema walk: every string leaf is an enum or a bounded stance/topic', () => {
    const freeText: string[] = [];
    const walk = (schema: z.ZodTypeAny, path: string[]) => {
      if (schema instanceof z.ZodObject) {
        for (const [key, child] of Object.entries(schema.shape)) {
          walk(child as z.ZodTypeAny, [...path, key]);
        }
        return;
      }
      if (schema instanceof z.ZodArray) {
        walk(schema.element as z.ZodTypeAny, path);
        return;
      }
      if (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) {
        walk(schema.unwrap() as z.ZodTypeAny, path);
        return;
      }
      if (schema instanceof z.ZodEnum) return; // closed vocabulary
      if (schema instanceof z.ZodString) {
        const leaf = path[path.length - 1];
        const checks = (schema._def.checks ?? []) as Array<
          | { kind?: string; value?: number }
          | { _zod?: { def?: { check?: string; maximum?: number } } }
        >;
        let max: number | null = null;
        for (const c of checks) {
          if ('kind' in c && c.kind === 'max' && typeof c.value === 'number') max = c.value;
          const z4 = (c as { _zod?: { def?: { check?: string; maximum?: number } } })._zod?.def;
          if (z4?.check === 'max_length' && typeof z4.maximum === 'number') max = z4.maximum;
        }
        const isBounded =
          (leaf === 'stance' && max !== null && max <= STANCE_MAX_CHARS) ||
          (leaf === 'topic' && max !== null && max <= TOPIC_MAX_CHARS) ||
          leaf === 'userId'; // uuid, not natural language
        if (!isBounded) freeText.push(path.join('.'));
        return;
      }
      if (
        schema instanceof z.ZodNumber ||
        schema instanceof z.ZodBoolean ||
        schema instanceof z.ZodUUID
      ) {
        return;
      }
      freeText.push(`${path.join('.')} (unexpected ${schema.constructor.name})`);
    };
    walk(redactedSnapshotSchema, []);
    expect(freeText).toEqual([]);
  });

  /**
   * End-to-end: plant canaries in every raw-text place (onboarding transcript
   * body, display name, about text) and prove none of them can appear in the
   * snapshot exchanged between the two users' agents.
   */
  it('canary e2e: transcript/name/about text never appear in the snapshot', async () => {
    const { userId, client } = await mkUser({
      stances: [{ topic: 'family', stance: 'Joint family only on festivals, nuclear otherwise' }],
    });
    const other = await mkUser({});
    anyClient = client;
    await admin.profile.update({
      where: { userId },
      data: { displayName: CANARY_NAME, aboutNormalised: CANARY_ABOUT },
    });
    await admin.onboardingSession.create({
      data: {
        userId,
        messages: { create: [{ role: 'user', content: CANARY_TRANSCRIPT, seq: 1 }] },
      },
    });

    const body = await snapshotOf(userId);
    const wire = canonicalJson(body.snapshot);
    expect(wire).not.toContain(CANARY_TRANSCRIPT);
    expect(wire).not.toContain(CANARY_NAME);
    expect(wire).not.toContain(CANARY_ABOUT);
    // and the strict schema still accepts exactly what crossed the wire
    expect(redactedSnapshotSchema.parse(body.snapshot)).toBeTruthy();

    // same for the other side of the pair
    const bodyB = await snapshotOf(other.userId);
    expect(canonicalJson(bodyB.snapshot)).not.toContain(CANARY_TRANSCRIPT);
  });
});

describe('write_screening_result', () => {
  const validVerdict = (a: SnapshotResponse, b: SnapshotResponse, overrides = {}) => ({
    verdict: 'COMPATIBLE',
    score: 0.9,
    topics: [{ topic: 'career_after_marriage', result: 'compatible' }],
    reasonCodes: [],
    modelVersion: MODEL_VERSION,
    ...hashBundle(a, b),
    ...overrides,
  });

  it('writes a verdict bound to the current snapshots; row is verifiable', async () => {
    const a = await mkUser({});
    const b = await mkUser({});
    anyClient = a.client;
    const sa = await snapshotOf(a.userId);
    const sb = await snapshotOf(b.userId);
    const res = await anyClient.req(
      'POST',
      '/v1/internal/tools/write_screening_result',
      { pair: [a.userId, b.userId], ...validVerdict(sa, sb) },
      { 'x-agent-token': tokenFor(['write_screening_result']) },
    );
    expect(res.status).toBe(200);
    const [userA, userB] = normalizePair(a.userId, b.userId);
    const row = await admin.screeningResult.findUnique({
      where: { userA_userB: { userA, userB } },
    });
    expect(row).not.toBeNull();
    expect(row?.verdict).toBe('COMPATIBLE');
    expect(row?.prefVersionA).toBe(1);
    expect(row?.prefVersionB).toBe(1);
    expect(row?.inputsHash).toBe(hashBundle(sa, sb).inputsHash);
    expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });

  it('normalises pair order: [B,A] write is found by an [A,B] lookup', async () => {
    const a = await mkUser({});
    const b = await mkUser({});
    anyClient = a.client;
    const sa = await snapshotOf(a.userId);
    const sb = await snapshotOf(b.userId);
    const res = await anyClient.req(
      'POST',
      '/v1/internal/tools/write_screening_result',
      { pair: [b.userId, a.userId], ...validVerdict(sa, sb) },
      { 'x-agent-token': tokenFor(['write_screening_result']) },
    );
    expect(res.status).toBe(200);
    const hit = await anyClient.req(
      'POST',
      '/v1/internal/screening/find-cached',
      { aUserId: a.userId, bUserId: b.userId },
      INTERNAL_TOKEN,
    );
    expect(hit.status).toBe(200);
    expect((hit.json as { status: string }).status).toBe('hit');
  });

  it('rejects unpinned model_version and free-text reason codes (400)', async () => {
    const a = await mkUser({});
    const b = await mkUser({});
    anyClient = a.client;
    const sa = await snapshotOf(a.userId);
    const sb = await snapshotOf(b.userId);
    const badModel = await anyClient.req(
      'POST',
      '/v1/internal/tools/write_screening_result',
      { pair: [a.userId, b.userId], ...validVerdict(sa, sb, { modelVersion: 'some-other-v9' }) },
      { 'x-agent-token': tokenFor(['write_screening_result']) },
    );
    expect(badModel.status).toBe(400);
    const badCode = await anyClient.req(
      'POST',
      '/v1/internal/tools/write_screening_result',
      {
        pair: [a.userId, b.userId],
        ...validVerdict(sa, sb, { reasonCodes: ['user_is_boring_and_rude'] }),
      },
      { 'x-agent-token': tokenFor(['write_screening_result']) },
    );
    expect(badCode.status).toBe(400);
  });

  it('409s when snapshots or inputs hash no longer match (mid-flight change)', async () => {
    const a = await mkUser({});
    const b = await mkUser({});
    anyClient = a.client;
    const sa = await snapshotOf(a.userId);
    const sb = await snapshotOf(b.userId);
    // preference change between snapshot fetch and write
    await a.client.put('/v1/me/preferences', { relocateOk: false }, a.client.csrfHeaders());
    const stale = await anyClient.req(
      'POST',
      '/v1/internal/tools/write_screening_result',
      { pair: [a.userId, b.userId], ...validVerdict(sa, sb) },
      { 'x-agent-token': tokenFor(['write_screening_result']) },
    );
    expect(stale.status).toBe(409);
    // tampered inputs hash
    const sa2 = await snapshotOf(a.userId);
    const forged = hashBundle(sa2, sb);
    const tampered = await anyClient.req(
      'POST',
      '/v1/internal/tools/write_screening_result',
      {
        pair: [a.userId, b.userId],
        ...validVerdict(sa2, sb, {
          inputsHash: inputsHash(forged.snapshotHashA, forged.snapshotHashB, 'forged-rules'),
        }),
      },
      { 'x-agent-token': tokenFor(['write_screening_result']) },
    );
    expect(tampered.status).toBe(409);
  });

  it('404s for unknown pair members; 401 without a token', async () => {
    const a = await mkUser({});
    anyClient = a.client;
    const ghost = crypto.randomUUID();
    const res = await anyClient.req(
      'POST',
      '/v1/internal/tools/write_screening_result',
      {
        pair: [a.userId, ghost],
        verdict: 'INCOMPATIBLE',
        score: 0,
        topics: [],
        reasonCodes: ['AGE'],
        modelVersion: MODEL_VERSION,
        snapshotHashA: '0'.repeat(64),
        snapshotHashB: '1'.repeat(64),
        inputsHash: '2'.repeat(64),
      },
      { 'x-agent-token': tokenFor(['write_screening_result']) },
    );
    expect(res.status).toBe(404);
    const anon = await anyClient.req('POST', '/v1/internal/tools/write_screening_result', {
      pair: [a.userId, ghost],
    });
    expect(anon.status).toBe(401);
  });
});

describe('find-cached (pair + preference-version cache)', () => {
  it('miss → write → hit; invalidated by preference change and expiry', async () => {
    const a = await mkUser({});
    const b = await mkUser({});
    anyClient = a.client;

    const miss1 = await anyClient.req(
      'POST',
      '/v1/internal/screening/find-cached',
      { aUserId: a.userId, bUserId: b.userId },
      INTERNAL_TOKEN,
    );
    expect(miss1.status).toBe(200);
    expect((miss1.json as { status: string }).status).toBe('miss');

    const sa = await snapshotOf(a.userId);
    const sb = await snapshotOf(b.userId);
    const write = await anyClient.req(
      'POST',
      '/v1/internal/tools/write_screening_result',
      {
        pair: [a.userId, b.userId],
        verdict: 'PARTIAL',
        score: 0.6,
        topics: [{ topic: 'family', result: 'partial' }],
        reasonCodes: ['SOFT_TOPIC_PARTIAL'],
        modelVersion: MODEL_VERSION,
        ...hashBundle(sa, sb),
      },
      { 'x-agent-token': tokenFor(['write_screening_result']) },
    );
    expect(write.status).toBe(200);

    const hit = await anyClient.req(
      'POST',
      '/v1/internal/screening/find-cached',
      { aUserId: a.userId, bUserId: b.userId },
      INTERNAL_TOKEN,
    );
    expect(hit.status).toBe(200);
    const hitBody = hit.json as { status: string; result: { verdict: string } };
    expect(hitBody.status).toBe('hit');
    expect(hitBody.result.verdict).toBe('PARTIAL');

    // preference change invalidates
    await b.client.put('/v1/me/preferences', { relocateOk: false }, b.client.csrfHeaders());
    const afterChange = await anyClient.req(
      'POST',
      '/v1/internal/screening/find-cached',
      { aUserId: a.userId, bUserId: b.userId },
      INTERNAL_TOKEN,
    );
    expect((afterChange.json as { status: string }).status).toBe('miss');

    // expiry invalidates
    const [userA, userB] = normalizePair(a.userId, b.userId);
    await admin.screeningResult.update({
      where: { userA_userB: { userA, userB } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const afterExpiry = await anyClient.req(
      'POST',
      '/v1/internal/screening/find-cached',
      { aUserId: a.userId, bUserId: b.userId },
      INTERNAL_TOKEN,
    );
    expect((afterExpiry.json as { status: string }).status).toBe('miss');
  });

  it('requires the service token; 404 for unknown pairs', async () => {
    const a = await mkUser({});
    anyClient = a.client;
    const anon = await anyClient.req('POST', '/v1/internal/screening/find-cached', {
      aUserId: a.userId,
      bUserId: crypto.randomUUID(),
    });
    expect(anon.status).toBe(401);
    const ghost = await anyClient.req(
      'POST',
      '/v1/internal/screening/find-cached',
      { aUserId: a.userId, bUserId: crypto.randomUUID() },
      INTERNAL_TOKEN,
    );
    expect(ghost.status).toBe(404);
  });
});
