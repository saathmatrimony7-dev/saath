/**
 * P4-01…P4-03 messaging: mutual-match conversation open, C4-encrypted
 * message bodies, pre-send contact masking (exit criterion 3), blocked-pair
 * gating, idempotent sends, participant-only visibility (RLS + 404 no-leak).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, signupTestUser, type TestApp } from '../helpers/test-app';
import type { MockModerationAgent } from '../../src/modules/safety/moderation-agent.js';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { seedTaxonomy } from '../../prisma/seed-taxonomy-runner';

let t: TestApp;
let admin: RlsPrismaClient;
let seq = 7100;

const today = () => new Date().toISOString().slice(0, 10);

async function mkUser() {
  seq += 1;
  const { client, userId } = await signupTestUser(t, `+9170${String(seq).padStart(8, '0')}`);
  await admin.user.update({
    where: { id: userId },
    data: { ageVerified: true, birthYear: new Date().getFullYear() - 28, status: 'active' },
  });
  return { client, userId };
}

/** Publishes a daily-match row so the owner can like the candidate. */
async function publishMatch(userId: string, candidateId: string, rank = 1) {
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

async function matchIdOf(userId: string, candidateId: string): Promise<string> {
  const row = await admin.dailyMatch.findFirst({ where: { userId, candidateId } });
  if (!row) throw new Error('match row missing');
  return row.id;
}

/** Mutual like via the real interactions surface → conversation opens. */
async function makeMutual() {
  const a = await mkUser();
  const b = await mkUser();
  await publishMatch(a.userId, b.userId);
  await publishMatch(b.userId, a.userId);
  const likeA = await a.client.post(
    `/v1/matches/${await matchIdOf(a.userId, b.userId)}/like`,
    {},
    a.client.csrfHeaders(),
  );
  expect(likeA.status).toBe(200);
  expect(likeA.json?.mutual).toBe(false);
  const likeB = await b.client.post(
    `/v1/matches/${await matchIdOf(b.userId, a.userId)}/like`,
    {},
    b.client.csrfHeaders(),
  );
  expect(likeB.status).toBe(200);
  expect(likeB.json?.mutual).toBe(true);
  return { a, b };
}

async function conversationIdOf(userA: string, userB: string): Promise<string> {
  const [lo, hi] = userA < userB ? [userA, userB] : [userB, userA];
  const row = await admin.conversation.findUnique({
    where: { userA_userB: { userA: lo, userB: hi } },
  });
  if (!row) throw new Error('conversation missing');
  return row.id;
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

describe('conversation open (P4-03)', () => {
  it('mutual like opens exactly one conversation, visible to both only', async () => {
    const { a, b } = await makeMutual();
    const convId = await conversationIdOf(a.userId, b.userId);

    const listA = await a.client.get('/v1/conversations');
    expect(listA.status).toBe(200);
    const convsA = listA.json as unknown as { id: string; origin: string; contactShared: boolean }[];
    expect(convsA.some((c) => c.id === convId && c.origin === 'mutual')).toBe(true);

    const listB = await b.client.get('/v1/conversations');
    expect((listB.json as unknown as { id: string }[]).some((c) => c.id === convId)).toBe(true);

    // RLS + no-existence-leak: an unrelated user gets 404, not 403.
    const outsider = await mkUser();
    const foreign = await outsider.client.get(`/v1/conversations/${convId}`);
    expect(foreign.status).toBe(404);
    const foreignMsgs = await outsider.client.get(`/v1/conversations/${convId}/messages`);
    expect(foreignMsgs.status).toBe(404);
    void foreign;

    // Re-liking is idempotent: still one conversation.
    await a.client.post(
      `/v1/matches/${await matchIdOf(a.userId, b.userId)}/like`,
      {},
      a.client.csrfHeaders(),
    );
    const count = await admin.conversation.count({
      where: {
        OR: [
          { userA: a.userId, userB: b.userId },
          { userA: b.userId, userB: a.userId },
        ],
      },
    });
    expect(count).toBe(1);
  });

  it('opening a conversation without a mutual match or credits is rejected', async () => {
    const me = await mkUser();
    const cand = await mkUser();
    const res = await me.client.post(
      '/v1/conversations',
      { candidateId: cand.userId },
      me.client.csrfHeaders(),
    );
    expect(res.status).toBe(403);
  });
});

describe('messages', () => {
  it('send → list round-trips the body; stored C4-encrypted (never plaintext)', async () => {
    const { a, b } = await makeMutual();
    const convId = await conversationIdOf(a.userId, b.userId);

    const sent = await a.client.post(
      `/v1/conversations/${convId}/messages`,
      { body: 'Namaste! Loved your profile.' },
      a.client.csrfHeaders(),
    );
    expect(sent.status).toBe(200);
    expect(sent.json?.body).toBe('Namaste! Loved your profile.');
    expect(sent.json?.moderationStatus).toBe('clean');

    const got = await b.client.get(`/v1/conversations/${convId}/messages`);
    expect(got.status).toBe(200);
    const msgs = got.json as unknown as { body: string; senderId: string }[];
    expect(msgs.at(-1)?.body).toBe('Namaste! Loved your profile.');

    // At rest: the raw column must not contain the plaintext.
    const row = await admin.message.findFirst({ where: { conversationId: convId } });
    expect(row).toBeTruthy();
    const raw = Buffer.from(row!.bodyEnc).toString('utf8');
    expect(raw.includes('Namaste')).toBe(false);
  });

  it('clientRef makes the send idempotent (§11)', async () => {
    const { a, b } = await makeMutual();
    const convId = await conversationIdOf(a.userId, b.userId);
    const first = await a.client.post(
      `/v1/conversations/${convId}/messages`,
      { body: 'hello once', clientRef: 'ref-1' },
      a.client.csrfHeaders(),
    );
    const again = await a.client.post(
      `/v1/conversations/${convId}/messages`,
      { body: 'hello once', clientRef: 'ref-1' },
      a.client.csrfHeaders(),
    );
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.json?.id).toBe(first.json?.id);
    const count = await admin.message.count({ where: { conversationId: convId } });
    expect(count).toBe(1);
  });

  it('contact masking blocks phone/email/links until BOTH opt in (exit criterion 3)', async () => {
    const { a, b } = await makeMutual();
    const convId = await conversationIdOf(a.userId, b.userId);

    // One-sided opt-in is not enough.
    await a.client.post(`/v1/conversations/${convId}/share-contact`, {}, a.client.csrfHeaders());
    const blocked = await a.client.post(
      `/v1/conversations/${convId}/messages`,
      { body: 'call me on 98765 43210' },
      a.client.csrfHeaders(),
    );
    expect(blocked.status).toBe(409);
    expect((blocked.json as unknown as { code: string }).code).toBe('CONTACT_MASKED');

    const emailBlocked = await a.client.post(
      `/v1/conversations/${convId}/messages`,
      { body: 'write to me at priya.sharma@gmail.com' },
      a.client.csrfHeaders(),
    );
    expect(emailBlocked.status).toBe(409);

    // Second side opts in → contact details flow.
    await b.client.post(`/v1/conversations/${convId}/share-contact`, {}, b.client.csrfHeaders());
    const conv = await a.client.get(`/v1/conversations/${convId}`);
    expect((conv.json as unknown as { contactShared: boolean }).contactShared).toBe(true);

    const allowed = await a.client.post(
      `/v1/conversations/${convId}/messages`,
      { body: 'call me on 98765 43210' },
      a.client.csrfHeaders(),
    );
    expect(allowed.status).toBe(200);

    // Non-contact text was never blocked.
    const plain = await b.client.post(
      `/v1/conversations/${convId}/messages`,
      { body: 'sure, evening works' },
      b.client.csrfHeaders(),
    );
    expect(plain.status).toBe(200);
  });

  it('a block after opening closes the conversation for messaging', async () => {
    const { a, b } = await makeMutual();
    const convId = await conversationIdOf(a.userId, b.userId);
    const block = await a.client.put(`/v1/users/${b.userId}/block`, {}, a.client.csrfHeaders());
    expect(block.status).toBe(200);
    const res = await b.client.post(
      `/v1/conversations/${convId}/messages`,
      { body: 'hello?' },
      b.client.csrfHeaders(),
    );
    expect(res.status).toBe(403);
  });

  it('flagged A9 verdicts mark the message (delivered, not dropped)', async () => {
    const { a, b } = await makeMutual();
    const convId = await conversationIdOf(a.userId, b.userId);
    // The mock moderation agent is safe-by-default; script a verdict via the
    // provider the safety module exports.
    const agent = t.app.get('MODERATION_AGENT' as never) as unknown as MockModerationAgent;
    agent.scripted = { label: 'money_request', confidence: 0.9 };
    try {
      const res = await a.client.post(
        `/v1/conversations/${convId}/messages`,
        { body: 'can you send money for tickets' },
        a.client.csrfHeaders(),
      );
      expect(res.status).toBe(200);
      expect(res.json?.moderationStatus).toBe('flagged');
    } finally {
      agent.scripted = null;
    }
    void b;
  });
});

describe('masked calls (P4-04)', () => {
  it('exposes provider refs only — never numbers', async () => {
    const { a, b } = await makeMutual();
    const convId = await conversationIdOf(a.userId, b.userId);
    // Free plan: calls are paywalled (asserted fully in paywall.spec.ts);
    // here we only verify the 403 contract carries the PAYWALL code.
    const denied = await a.client.post(`/v1/conversations/${convId}/calls`, {}, a.client.csrfHeaders());
    expect(denied.status).toBe(403);
    expect((denied.json as unknown as { code: string }).code).toBe('PAYWALL');
    void b;
  });
});
