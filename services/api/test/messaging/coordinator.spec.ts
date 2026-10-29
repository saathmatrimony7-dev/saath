/**
 * P4-09 A8 coordinator: user-facing suggest endpoint (mock transport) and
 * the agent-token tool surface (propose_slots / send_nudge /
 * record_meeting_feedback) with agent + user-binding authz.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, signupTestUser, TestClient, type TestApp } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { mintAgentToken } from '../../src/modules/llm-gateway/agent-token';

const SECRET = 'dev-agent-token-hmac-secret';
const A8 = 'A8-coordinator';
const A4 = 'A4-matchmaker';

let t: TestApp;
let admin: RlsPrismaClient;
let seq = 10100;

async function mkUser() {
  seq += 1;
  const { client, userId } = await signupTestUser(t, `+9133${String(seq).padStart(8, '0')}`);
  return { client, userId };
}

const tokenFor = (user: string, tools: string[], agent = A8) =>
  mintAgentToken(SECRET, { agent, acting_for_user_id: user, tools }, 600);

async function openConversationDirect(userA: string, userB: string): Promise<string> {
  const [lo, hi] = userA < userB ? [userA, userB] : [userB, userA];
  const created = await admin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.service', 'messaging', true)`;
    return tx.conversation.create({ data: { userA: lo, userB: hi, origin: 'mutual' } });
  });
  return created.id;
}

beforeAll(async () => {
  t = await bootTestApp();
  admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
});

afterAll(async () => {
  await admin.$disconnect();
  await t.app.close();
});

describe('POST /v1/conversations/:id/suggest', () => {
  it('returns deterministic suggestions for the caller only', async () => {
    const me = await mkUser();
    const other = await mkUser();
    const convId = await openConversationDirect(me.userId, other.userId);

    const anon = await new TestClient(t.baseUrl).post(`/v1/conversations/${convId}/suggest`, {});
    expect(anon.status).toBe(401);

    const res = await me.client.post(
      `/v1/conversations/${convId}/suggest`,
      {},
      me.client.csrfHeaders(),
    );
    expect(res.status).toBe(200);
    const body = res.json as unknown as { icebreakers: string[]; slots: string[] };
    expect(body.icebreakers.length).toBeGreaterThanOrEqual(3);
    expect(body.slots).toEqual([]);
  });
});

describe('A8 tool authz', () => {
  it('anonymous 401; wrong agent 403; token for user A cannot act for user B', async () => {
    const me = await mkUser();
    const other = await mkUser();
    const convId = await openConversationDirect(me.userId, other.userId);
    const path = '/v1/internal/tools/propose_slots';
    const payload = { userId: me.userId, conversationId: convId, slots: ['2026-11-01T10:00:00Z'] };

    const anon = await me.client.req('POST', path, payload);
    expect(anon.status).toBe(401);

    const wrongAgent = await me.client.req('POST', path, payload, {
      'x-agent-token': tokenFor(me.userId, ['propose_slots'], A4),
    });
    expect(wrongAgent.status).toBe(403);

    const wrongUser = await me.client.req('POST', path, { ...payload, userId: other.userId }, {
      'x-agent-token': tokenFor(me.userId, ['propose_slots']),
    });
    expect(wrongUser.status).toBe(403);

    const allowListMiss = await me.client.req('POST', path, payload, {
      'x-agent-token': tokenFor(me.userId, ['send_nudge']),
    });
    expect(allowListMiss.status).toBe(403);
  });
});

describe('A8 tools against a conversation', () => {
  it('propose_slots → stored on the conversation; nudge notifies own user only; feedback recorded', async () => {
    const me = await mkUser();
    const other = await mkUser();
    const convId = await openConversationDirect(me.userId, other.userId);

    const slots = await me.client.req(
      'POST',
      '/v1/internal/tools/propose_slots',
      { userId: me.userId, conversationId: convId, slots: ['2026-11-01T10:00:00Z', '2026-11-02T18:30:00Z'] },
      { 'x-agent-token': tokenFor(me.userId, ['propose_slots']) },
    );
    expect(slots.status).toBe(200);
    expect(slots.json?.proposed).toBe(2);

    const conv = await me.client.get(`/v1/conversations/${convId}`);
    expect(conv.status).toBe(200);
    expect((conv.json as unknown as { proposedSlots: string[] }).proposedSlots).toHaveLength(2);

    // Deterministic delivery: disable quiet hours for this user (the default
    // 22:00–08:00 IST window would suppress the nudge during evening runs).
    await me.client.put(
      '/v1/notifications/settings',
      { quietStartMin: 0, quietEndMin: 0, dailyCap: 20, channels: { inapp: true, whatsapp: false } },
      me.client.csrfHeaders(),
    );

    // Nudge → notification to MYSELF only (A8 never contacts the other side).
    const nudge = await me.client.req(
      'POST',
      '/v1/internal/tools/send_nudge',
      { userId: me.userId, conversationId: convId },
      { 'x-agent-token': tokenFor(me.userId, ['send_nudge']) },
    );
    expect(nudge.status).toBe(200);
    const mine = (await me.client.get('/v1/notifications')).json as unknown as { type: string; payload: { kind: string } }[];
    expect(mine.some((n) => n.type === 'coordinator.suggestion' && n.payload.kind === 'nudge')).toBe(true);
    const theirs = (await other.client.get('/v1/notifications')).json as unknown as unknown[];
    expect(theirs.filter((n) => (n as { type: string }).type === 'coordinator.suggestion')).toHaveLength(0);

    const feedback = await me.client.req(
      'POST',
      '/v1/internal/tools/record_meeting_feedback',
      { userId: me.userId, conversationId: convId, outcome: 'went_well', notes: 'lovely coffee meet' },
      { 'x-agent-token': tokenFor(me.userId, ['record_meeting_feedback']) },
    );
    expect(feedback.status).toBe(200);

    // Notes are C4-encrypted at rest.
    const raw = await admin.conversation.findUnique({ where: { id: convId } });
    const fb = raw?.meetingFeedback as { notesEnc: string } | null;
    expect(fb?.notesEnc).toBeTruthy();
    expect(Buffer.from(fb!.notesEnc, 'base64').toString('utf8')).not.toContain('lovely coffee meet');
  });
});
