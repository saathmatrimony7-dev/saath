/**
 * P4 paywall enforcement (EXIT CRITERION 2 â€” server-side): free daily
 * message cap, masked calls behind the paid entitlement, intro-pack
 * credits opening non-mutual conversations, full masked-call lifecycle.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, signupTestUser, type TestApp } from '../helpers/test-app';
import type { TestClient } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { signRazorpayWebhookForTests } from '../../src/modules/billing/razorpay-webhook.controller';

let t: TestApp;
let admin: RlsPrismaClient;
let seq = 9100;

const WEBHOOK_SECRET = 'dev-razorpay-webhook-secret';

async function mkUser() {
  seq += 1;
  const { client, userId } = await signupTestUser(t, `+9155${String(seq).padStart(8, '0')}`);
  return { client, userId };
}

async function openConversationDirect(userA: string, userB: string): Promise<string> {
  const [lo, hi] = userA < userB ? [userA, userB] : [userB, userA];
  const created = await admin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.service', 'messaging', true)`;
    return tx.conversation.create({ data: { userA: lo, userB: hi, origin: 'mutual' } });
  });
  return created.id;
}

async function postWebhook(client: TestClient, payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  return client.req('POST', '/v1/hooks/razorpay', payload, {
    'content-type': 'application/json',
    'x-razorpay-signature': signRazorpayWebhookForTests(WEBHOOK_SECRET, body),
  });
}

async function activatePlan(client: TestClient, planCode: string): Promise<void> {
  const created = await client.post('/v1/subscriptions', { planCode }, client.csrfHeaders());
  expect(created.status).toBe(200);
  const providerSubId = (created.json as unknown as { providerSubId: string }).providerSubId;
  const wh = await postWebhook(client, {
    event: 'subscription.activated',
    payload: { subscription: { entity: { id: providerSubId } } },
  });
  expect(wh.status).toBe(200);
}

beforeAll(async () => {
  t = await bootTestApp();
  admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
});

afterAll(async () => {
  await admin.$disconnect();
  await t.app.close();
});

describe('daily message cap (free plan)', () => {
  it('blocks the 21st message in a UTC day with PAYWALL; unlimited on plus', async () => {
    const free = await mkUser();
    const buddy = await mkUser();
    const convId = await openConversationDirect(free.userId, buddy.userId);

    let last = 0;
    for (let i = 1; i <= 20; i++) {
      const res = await free.client.post(
        `/v1/conversations/${convId}/messages`,
        { body: `msg ${i}` },
        free.client.csrfHeaders(),
      );
      last = res.status;
    }
    expect(last).toBe(200);
    const capped = await free.client.post(
      `/v1/conversations/${convId}/messages`,
      { body: 'one too many' },
      free.client.csrfHeaders(),
    );
    expect(capped.status).toBe(403);
    expect((capped.json as unknown as { code: string }).code).toBe('PAYWALL');

    // Upgrade â†’ cap disappears (server reads entitlements, not the client).
    await activatePlan(free.client, 'plus_monthly');
    const after = await free.client.post(
      `/v1/conversations/${convId}/messages`,
      { body: '21st message, now fine' },
      free.client.csrfHeaders(),
    );
    expect(after.status).toBe(200);
  });
});

describe('masked calls behind the paid entitlement', () => {
  it('403 PAYWALL for free, full lifecycle once activated; numbers never exposed', async () => {
    const caller = await mkUser();
    const callee = await mkUser();
    const convId = await openConversationDirect(caller.userId, callee.userId);

    const denied = await caller.client.post(
      `/v1/conversations/${convId}/calls`,
      {},
      caller.client.csrfHeaders(),
    );
    expect(denied.status).toBe(403);
    expect((denied.json as unknown as { code: string }).code).toBe('PAYWALL');

    await activatePlan(caller.client, 'plus_monthly');
    const started = await caller.client.post(
      `/v1/conversations/${convId}/calls`,
      {},
      caller.client.csrfHeaders(),
    );
    expect(started.status).toBe(200);
    const call = started.json as unknown as { id: string; providerRef: string; status: string };
    expect(call.providerRef).toMatch(/^call_mock_/);
    // The callee sees the call log too â€” provider refs only.
    const calleeView = await callee.client.get(`/v1/conversations/${convId}/calls`);
    expect(calleeView.status).toBe(200);
    const calls = calleeView.json as unknown as { providerRef: string }[];
    expect(calls.some((c) => c.providerRef === call.providerRef)).toBe(true);
    const leak = JSON.stringify(calls).match(/\+91|\d{10}/);
    expect(leak, "leaked digits in call surface: " + JSON.stringify(calls)).toBeNull();

    const ended = await caller.client.post(
      `/v1/conversations/${convId}/calls/${call.id}/end`,
      { status: 'completed', durationSec: 612 },
      caller.client.csrfHeaders(),
    );
    expect(ended.status).toBe(200);
    expect(ended.json?.status).toBe('completed');
    expect(ended.json?.durationSec).toBe(612);

    // Double-end is idempotent.
    const again = await callee.client.post(
      `/v1/conversations/${convId}/calls/${call.id}/end`,
      { status: 'completed' },
      callee.client.csrfHeaders(),
    );
    expect(again.json?.durationSec).toBe(612);
  });
});

describe('intro packs open non-mutual conversations', () => {
  it('credits from payment.captured spend exactly one per open', async () => {
    const me = await mkUser();
    const cand = await mkUser();
    void t;

    // No credits â†’ paywalled.
    const denied = await me.client.post(
      '/v1/conversations',
      { candidateId: cand.userId },
      me.client.csrfHeaders(),
    );
    expect(denied.status).toBe(403);
    expect((denied.json as unknown as { code: string }).code).toBe('PAYWALL');

    // Buy the pack: order â†’ (verified) payment.captured â†’ credits.
    const order = await me.client.post(
      '/v1/intro-packs/orders',
      { planCode: 'intro_5' },
      me.client.csrfHeaders(),
    );
    expect(order.status).toBe(200);
    const providerOrderId = (order.json as unknown as { providerOrderId: string }).providerOrderId;
    const wh = await postWebhook(me.client, {
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_pack_a', order_id: providerOrderId, amount: 49000 } } },
    });
    expect(wh.status).toBe(200);

    const ent = await admin.entitlement.findUnique({ where: { userId: me.userId } });
    expect(ent?.introCredits).toBe(5);

    // Open a non-mutual conversation: one credit spent.
    const opened = await me.client.post(
      '/v1/conversations',
      { candidateId: cand.userId },
      me.client.csrfHeaders(),
    );
    expect(opened.status).toBe(200);
    expect(opened.json?.origin).toBe('intro');
    const entAfter = await admin.entitlement.findUnique({ where: { userId: me.userId } });
    expect(entAfter?.introCredits).toBe(4);

    // Idempotent re-open of the same pair costs nothing.
    const again = await me.client.post(
      '/v1/conversations',
      { candidateId: cand.userId },
      me.client.csrfHeaders(),
    );
    expect(again.json?.id).toBe(opened.json?.id);
    expect((await admin.entitlement.findUnique({ where: { userId: me.userId } }))?.introCredits).toBe(4);

    // The recipient can read the intro conversation and reply.
    const convId = opened.json?.id as string;
    const reply = await cand.client.post(
      `/v1/conversations/${convId}/messages`,
      { body: 'hi, thanks for reaching out' },
      cand.client.csrfHeaders(),
    );
    expect(reply.status).toBe(200);
  });
});
