/**
 * P4-06/07 billing + Razorpay webhook: signature verification, idempotent
 * event processing (EXIT CRITERION 1 — webhook replay test), sequential
 * GST-inclusive invoices, subscription lifecycle → entitlements.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, signupTestUser, TestClient, type TestApp } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { signRazorpayWebhookForTests } from '../../src/modules/billing/razorpay-webhook.controller';

let t: TestApp;
let admin: RlsPrismaClient;
let seq = 8100;

const WEBHOOK_SECRET = 'dev-razorpay-webhook-secret';

async function mkUser() {
  seq += 1;
  const { client, userId } = await signupTestUser(t, `+9166${String(seq).padStart(8, '0')}`);
  return { client, userId };
}

/** POSTs a Razorpay webhook with a valid signature; returns the response. */
async function postWebhook(client: TestClient, payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  return client.req('POST', '/v1/hooks/razorpay', payload, {
    'content-type': 'application/json',
    'x-razorpay-signature': signRazorpayWebhookForTests(WEBHOOK_SECRET, body),
  });
}

function subscriptionEvent(
  event: string,
  providerSubId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    event,
    payload: {
      subscription: { entity: { id: providerSubId } },
      ...extra,
    },
  };
}

function paymentCaptured(providerPaymentId: string, orderId: string, amount: number) {
  return {
    event: 'payment.captured',
    payload: {
      payment: { entity: { id: providerPaymentId, order_id: orderId, amount } },
    },
  };
}

async function openConversationDirect(userA: string, userB: string): Promise<string> {
  const [lo, hi] = userA < userB ? [userA, userB] : [userB, userA];
  const existing = await admin.conversation.findUnique({
    where: { userA_userB: { userA: lo, userB: hi } },
  });
  if (existing) return existing.id;
  const created = await admin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.service', 'messaging', true)`;
    return tx.conversation.create({ data: { userA: lo, userB: hi, origin: 'mutual' } });
  });
  return created.id;
}

/** True when the user can initiate a masked call on their conversation. */
async function callAllowed(client: TestClient, otherUserId: string, userId: string): Promise<boolean> {
  const convId = await openConversationDirect(userId, otherUserId);
  const res = await client.post(`/v1/conversations/${convId}/calls`, {}, client.csrfHeaders());
  return res.status !== 403;
}

beforeAll(async () => {
  t = await bootTestApp();
  admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
});

afterAll(async () => {
  await admin.$disconnect();
  await t.app.close();
});

describe('plans + subscription lifecycle', () => {
  it('lists seeded plans (free recurring + intro packs), authenticated only', async () => {
    const anon = await new TestClient(t.baseUrl).get('/v1/plans');
    expect(anon.status).toBe(401);
    const { client } = await mkUser();
    const res = await client.get('/v1/plans');
    expect(res.status).toBe(200);
    const plans = res.json as unknown as { code: string; kind: string; pricePaise: number }[];
    const codes = plans.map((p) => p.code);
    expect(codes).toContain('free');
    expect(codes).toContain('plus_monthly');
    expect(codes).toContain('intro_5');
    expect(plans.find((p) => p.code === 'free')?.pricePaise).toBe(0);
    expect(plans.find((p) => p.code === 'intro_5')?.kind).toBe('intro_pack');
  });

  it('subscription.activated webhook activates the plan → entitlements', async () => {
    const { client, userId } = await mkUser();
    const other = await mkUser();
    const created = await client.post(
      '/v1/subscriptions',
      { planCode: 'plus_monthly', clientRef: 'sub-1' },
      client.csrfHeaders(),
    );
    expect(created.status).toBe(200);
    const providerSubId = (created.json as unknown as { providerSubId: string }).providerSubId;
    expect(created.json?.status).toBe('pending');

    // The HTTP response alone grants NOTHING (paywall integrity, criterion 2).
    expect(await callAllowed(client, other.userId, userId)).toBe(false);

    const wh = await postWebhook(client, subscriptionEvent('subscription.activated', providerSubId));
    expect(wh.status).toBe(200);
    expect(wh.json?.received).toBe(true);

    const sub = await admin.subscription.findUnique({ where: { providerSubId } });
    expect(sub?.status).toBe('active');
    expect(sub?.currentPeriodEnd).toBeTruthy();
    const ent = await admin.entitlement.findUnique({ where: { userId } });
    expect(ent?.validUntil).toBeTruthy();
    expect(await callAllowed(client, other.userId, userId)).toBe(true);
  });

  it('clientRef on subscription create is idempotent (§11)', async () => {
    const { client } = await mkUser();
    const first = await client.post(
      '/v1/subscriptions',
      { planCode: 'plus_monthly', clientRef: 'idem-1' },
      client.csrfHeaders(),
    );
    const second = await client.post(
      '/v1/subscriptions',
      { planCode: 'plus_monthly', clientRef: 'idem-1' },
      client.csrfHeaders(),
    );
    expect(second.status).toBe(200);
    expect(second.json?.id).toBe(first.json?.id);
    expect(second.json?.providerSubId).toBe(first.json?.providerSubId);
  });
});

describe('webhook idempotency (EXIT CRITERION 1)', () => {
  it('rejects bad signatures, replays are 200 no-ops, state does not double-apply', async () => {
    const { client, userId } = await mkUser();
    const created = await client.post(
      '/v1/subscriptions',
      { planCode: 'plus_monthly' },
      client.csrfHeaders(),
    );
    const providerSubId = (created.json as unknown as { providerSubId: string }).providerSubId;

    // Bad signature → 401, nothing recorded.
    const bad = await client.req('POST', '/v1/hooks/razorpay', subscriptionEvent('subscription.activated', providerSubId), {
      'content-type': 'application/json',
      'x-razorpay-signature': 'deadbeef'.repeat(8),
    });
    expect(bad.status).toBe(401);

    const evt = subscriptionEvent('subscription.charged', providerSubId, {
      payment: { entity: { id: 'pay_1', amount: 59000 } },
    });
    const first = await postWebhook(client, evt);
    expect(first.status).toBe(200);

    // Replay the exact same delivery → acknowledged, not reprocessed.
    const replay = await postWebhook(client, evt);
    expect(replay.status).toBe(200);
    expect(replay.json?.duplicate).toBe(true);

    const sub = await admin.subscription.findUnique({ where: { providerSubId } });
    const periodEnd = sub!.currentPeriodEnd!.getTime();
    // One renewal applied exactly once: period extended ~1 month, one payment,
    // one invoice.
    const payments = await admin.payment.findMany({ where: { userId } });
    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe('captured');
    const invoices = await admin.invoice.findMany({ where: { userId } });
    expect(invoices).toHaveLength(1);
    // A second identical delivery must not extend the period again.
    const replayAgain = await postWebhook(client, evt);
    expect(replayAgain.json?.duplicate).toBe(true);
    const sub2 = await admin.subscription.findUnique({ where: { providerSubId } });
    expect(sub2!.currentPeriodEnd!.getTime()).toBe(periodEnd);
    expect(await admin.payment.count({ where: { userId } })).toBe(1);
  });

  it('payment.captured replays do not double-credit intro packs', async () => {
    const { client, userId } = await mkUser();
    const order = await client.post(
      '/v1/intro-packs/orders',
      { planCode: 'intro_5', clientRef: 'order-1' },
      client.csrfHeaders(),
    );
    expect(order.status).toBe(200);
    const providerOrderId = (order.json as unknown as { providerOrderId: string }).providerOrderId;

    const evt = paymentCaptured('pay_pack_1', providerOrderId, 49000);
    const first = await postWebhook(client, evt);
    expect(first.status).toBe(200);
    const replay = await postWebhook(client, evt);
    expect(replay.json?.duplicate).toBe(true);

    const ent = await admin.entitlement.findUnique({ where: { userId } });
    expect(ent?.introCredits).toBe(5); // credited once, not ten
    expect(await admin.invoice.count({ where: { userId } })).toBe(1);
  });

  it('self-serve cancel keeps the plan active to period end', async () => {
    const { client, userId } = await mkUser();
    const created = await client.post(
      '/v1/subscriptions',
      { planCode: 'plus_monthly' },
      client.csrfHeaders(),
    );
    const subId = created.json?.id as string;
    const providerSubId = (created.json as unknown as { providerSubId: string }).providerSubId;
    await postWebhook(client, subscriptionEvent('subscription.activated', providerSubId));

    const cancel = await client.post(`/v1/subscriptions/${subId}/cancel`, {}, client.csrfHeaders());
    expect(cancel.status).toBe(200);
    const sub = await admin.subscription.findUnique({ where: { id: subId } });
    expect(sub?.cancelAtPeriodEnd).toBe(true);
    expect(sub?.status).toBe('active'); // active to period end (§13)
    // Calls still work until the period ends.
    const other = await mkUser();
    expect(await callAllowed(client, other.userId, userId)).toBe(true);
  });
});

describe('invoices (P4-06)', () => {
  it('sequential per-year numbering with GST split out of the inclusive price', async () => {
    const { client, userId } = await mkUser();
    const created = await client.post(
      '/v1/subscriptions',
      { planCode: 'plus_monthly' },
      client.csrfHeaders(),
    );
    const providerSubId = (created.json as unknown as { providerSubId: string }).providerSubId;
    await postWebhook(
      client,
      subscriptionEvent('subscription.charged', providerSubId, {
        payment: { entity: { id: 'pay_inv_1', amount: 59000 } },
      }),
    );
    await postWebhook(
      client,
      subscriptionEvent('subscription.charged', providerSubId, {
        payment: { entity: { id: 'pay_inv_2', amount: 59000 } },
      }),
    );

    const invoices = (await client.get('/v1/invoices')).json as unknown as {
      invoiceNo: string;
      amountPaise: number;
      gstPaise: number;
    }[];
    expect(invoices).toHaveLength(2);
    const year = new Date().getUTCFullYear();
    // Globally sequential per calendar year (shared across users): distinct,
    // formatted, and the newer invoice carries the higher sequence.
    const seqOf = (no: string) => Number(no.split('-')[2]);
    for (const inv of invoices) {
      expect(inv.invoiceNo).toMatch(new RegExp(`^INV-${year}-\\d{6}$`));
    }
    expect(seqOf(invoices[0]!.invoiceNo)).toBeGreaterThan(seqOf(invoices[1]!.invoiceNo));
    expect(invoices[0]?.amountPaise).toBe(59000);
    // 18% GST inclusive: gst = 59000 * 1800 / 11800 = 9000.
    expect(invoices[0]?.gstPaise).toBe(9000);
    void userId;
  });
});

