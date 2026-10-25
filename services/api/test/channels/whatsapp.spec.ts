/**
 * WhatsApp channel tests (P1-09):
 * - signature verification: bad/missing signature → 401
 * - idempotency: replayed message id → ignored (no duplicate outbound)
 * - consent gate: no whatsapp consent → inbound acknowledged, zero replies
 * - opt-out keyword → consent withdrawal row + ack, then silence
 * - unknown phone numbers are ignored
 * - e2e: full onboarding interview completes over the webhook IN HINDI,
 *   driving the SAME A1 session engine; profile confirmed via the web API
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { bootTestApp, signupTestUser, TestClient, type TestApp } from '../helpers/test-app';

process.env.ONBOARDING_MAX_TURNS = '6';

const SECRET = 'test-whatsapp-webhook-secret-0123456789';
const PHONE = '+919876500101';

let t: TestApp;
let client: TestClient; // authed web client for the WhatsApp user
let hook: TestClient; // unauthenticated webhook client

function sign(body: unknown): string {
  return `sha256=${createHmac('sha256', SECRET).update(JSON.stringify(body)).digest('hex')}`;
}

function payload(from: string, messageId: string, body: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-test',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '123456' },
              contacts: [{ wa_id: from.replace('+', ''), profile: { name: 'Test' } }],
              messages: [
                { from: from.replace('+', ''), id: messageId, type: 'text', text: { body } },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function postWebhook(body: unknown, signature?: string) {
  return hook.post('/v1/hooks/whatsapp', body, {
    'x-hub-signature-256': signature ?? sign(body),
  });
}

async function grantWhatsAppConsent(c: TestClient) {
  const res = await c.put(
    '/v1/me/consents/whatsapp',
    { granted: true, channel: 'whatsapp' },
    c.csrfHeaders(),
  );
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  t = await bootTestApp();
  hook = new TestClient(t.baseUrl);
  ({ client } = await signupTestUser(t, PHONE));
});

afterAll(async () => {
  await t.app.close();
});

describe('whatsapp webhook signature verification', () => {
  it('rejects a bad signature with 401', async () => {
    const res = await postWebhook(payload(PHONE, 'wamid.bad-sig', 'hello'), 'sha256=deadbeef');
    expect(res.status).toBe(401);
    expect(t.mockWhatsApp.outbox).toHaveLength(0);
  });

  it('rejects a missing signature with 401', async () => {
    const body = payload(PHONE, 'wamid.no-sig', 'hello');
    const res = await hook.post('/v1/hooks/whatsapp', body);
    expect(res.status).toBe(401);
  });

  it('rejects a malformed payload with 400 (strict schema)', async () => {
    const res = await postWebhook({ nope: true });
    expect(res.status).toBe(400);
  });
});

describe('whatsapp consent gate', () => {
  it('acknowledges inbound but replies nothing without whatsapp consent', async () => {
    const res = await postWebhook(payload(PHONE, 'wamid.no-consent', 'नमस्ते'));
    expect(res.status).toBe(200);
    expect(t.mockWhatsApp.outbox).toHaveLength(0);
  });
});

describe('whatsapp onboarding interview (Hindi, mock engine)', () => {
  it('completes the interview turn by turn and the profile confirms', async () => {
    await grantWhatsAppConsent(client);
    const answers = [
      'मैं पुणे में सॉफ़्टवेयर इंजीनियर हूँ।',
      'मुझे दयालुता और समान विचार ज़रूरी हैं।',
      'छुट्टियों में मैं पढ़ता और घूमता हूँ।',
      'हम चार लोगों का परिवार हैं।',
      'हाँ, ज़रूरत पड़ने पर शहर बदल सकता हूँ।',
      'धूम्रपान बिल्कुल नहीं।',
      'बस इतना ही।',
    ];

    let done = false;
    for (const [i, answer] of answers.entries()) {
      const res = await postWebhook(payload(PHONE, `wamid.turn-${i}`, answer));
      expect(res.status).toBe(200);
      const last = t.mockWhatsApp.outbox.at(-1);
      expect(last?.toE164).toBe(PHONE);
      expect(last && last.text.length > 0).toBe(true);
      if (last?.text.includes('समीक्षा')) {
        done = true;
        break;
      }
    }
    expect(done).toBe(true);

    // The greeting and every interview reply are AI-labelled engine output.
    expect(t.mockWhatsApp.outbox[0]?.text).toContain('[AI]');
    expect(t.mockWhatsApp.outbox[0]?.text).toContain('नमस्ते');

    // Same engine as the web: the session is resumable/confirmable via the API.
    const latest = await client.get('/v1/onboarding/sessions');
    expect(latest.status).toBe(200);
    const { sessionId, status } = latest.json as { sessionId: string; status: string };
    expect(status).toBe('awaiting_confirm');

    const confirm = await client.post(
      '/v1/onboarding/confirm',
      { sessionId, confirmed: true },
      client.csrfHeaders(),
    );
    expect(confirm.status).toBe(200);

    // After confirmation, further inbound gets no interview reply.
    const count = t.mockWhatsApp.outbox.length;
    await postWebhook(payload(PHONE, 'wamid.after-confirm', 'धन्यवाद'));
    expect(t.mockWhatsApp.outbox).toHaveLength(count);
  });

  it('stays silent once the profile is confirmed', async () => {
    const count = t.mockWhatsApp.outbox.length;
    await postWebhook(payload(PHONE, 'wamid.confirmed-again', 'नमस्ते'));
    expect(t.mockWhatsApp.outbox).toHaveLength(count);
  });

  it('ignores a replayed message id', async () => {
    // Fresh user so the first delivery actually produces replies.
    const phone = '+919876500102';
    const { client: c2 } = await signupTestUser(t, phone);
    await grantWhatsAppConsent(c2);

    const body = payload(phone, 'wamid.replay-1', 'नमस्ते');
    const before = t.mockWhatsApp.outbox.length;
    expect((await postWebhook(body)).status).toBe(200);
    const afterFirst = t.mockWhatsApp.outbox.length;
    expect(afterFirst).toBeGreaterThan(before);

    expect((await postWebhook(body)).status).toBe(200);
    expect(t.mockWhatsApp.outbox).toHaveLength(afterFirst);
  });

  it('handles the opt-out keyword: withdrawal row, ack, then silence', async () => {
    const ackCount = t.mockWhatsApp.outbox.length + 1;
    expect((await postWebhook(payload(PHONE, 'wamid.optout', 'STOP'))).status).toBe(200);
    expect(t.mockWhatsApp.outbox).toHaveLength(ackCount);
    // Language follows the inbound script; 'STOP' is ASCII → account locale (en).
    expect(t.mockWhatsApp.outbox.at(-1)?.text).toContain('unsubscribed');

    const consents = await client.get('/v1/me/consents');
    expect(consents.status).toBe(200);
    const rows = consents.json as unknown as { purpose: string; granted: boolean | null }[];
    expect(rows.find((r) => r.purpose === 'whatsapp')?.granted).toBe(false);

    // Post-opt-out inbound gets nothing (consent required before any message).
    await postWebhook(payload(PHONE, 'wamid.post-optout', 'नमस्ते, कौन है?'));
    expect(t.mockWhatsApp.outbox).toHaveLength(ackCount);
  });

  it('ignores messages from unknown phone numbers', async () => {
    const count = t.mockWhatsApp.outbox.length;
    const res = await postWebhook(payload('+919000000000', 'wamid.unknown', 'hello'));
    expect(res.status).toBe(200);
    expect(t.mockWhatsApp.outbox).toHaveLength(count);
  });
});
