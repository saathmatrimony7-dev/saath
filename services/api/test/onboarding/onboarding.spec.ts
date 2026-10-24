/**
 * Onboarding tests (P1-06):
 * - session start/resume; every assistant message AI-labelled
 * - message endpoint streams SSE deltas + done{status, turnCount}
 * - interview caps at ONBOARDING_MAX_TURNS then awaits confirmation
 * - profile goes live ONLY via explicit confirm (409 before, visibility flip after)
 * - Hindi locale flow (greeting + replies in Hindi)
 * - authz: anonymous 401, no-CSRF 403, foreign transcript 404
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, signupTestUser, TestClient, type TestApp } from '../helpers/test-app';

process.env.ONBOARDING_MAX_TURNS = '5';

let t: TestApp;
let client: TestClient;
let userId: string;
let other: TestClient;
let hindi: TestClient;

interface StartResponse {
  sessionId: string;
  status: string;
  message: string;
  resumed: boolean;
}

interface DoneEvent {
  type: string;
  status?: string;
  turnCount?: number;
  reply?: string;
}

function cookieHeader(c: TestClient): string {
  return [...c.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function postTurn(c: TestClient, sessionId: string, text: string) {
  const res = await fetch(`${t.baseUrl}/v1/onboarding/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...c.csrfHeaders(), cookie: cookieHeader(c) },
    body: JSON.stringify({ text }),
  });
  const body = await res.text();
  const events = body
    .split('\n\n')
    .filter((s) => s.startsWith('data: '))
    .map((s) => JSON.parse(s.slice(6)) as DoneEvent);
  return { status: res.status, events };
}

async function start(locale: string, c: TestClient): Promise<StartResponse> {
  const res = await c.req('POST', '/v1/onboarding/sessions', { locale }, c.csrfHeaders());
  if (res.status !== 201) throw new Error(`start failed: ${res.status}`);
  return res.json as unknown as StartResponse;
}

beforeAll(async () => {
  t = await bootTestApp();
  ({ client, userId } = await signupTestUser(t, '+919100000501'));
  other = (await signupTestUser(t, '+919100000502')).client;
  hindi = (await signupTestUser(t, '+919100000503')).client;
});

afterAll(async () => {
  await t.app.close();
});

describe('onboarding interview (English)', () => {
  let sessionId: string;

  it('starts a session with an AI-labelled greeting', async () => {
    const s = await start('en', client);
    expect(s.resumed).toBe(false);
    expect(s.message.startsWith('[AI] ')).toBe(true);
    sessionId = s.sessionId;
  });

  it('resumes the same session instead of creating a new one', async () => {
    const s = await start('en', client);
    expect(s.resumed).toBe(true);
    expect(s.sessionId).toBe(sessionId);
  });

  it('streams SSE turns and stops at the turn cap awaiting confirmation', async () => {
    let done: DoneEvent | undefined;
    for (let i = 0; i < 6; i++) {
      const { status, events } = await postTurn(client, sessionId, `answer number ${i + 1}`);
      expect(status).toBe(200);
      expect(events[0]?.type).toBe('delta');
      done = events.at(-1);
    }
    expect(done?.type).toBe('done');
    expect(done?.status).toBe('awaiting_confirm');
    expect(done?.turnCount).toBe(6); // 5 question turns (cap) + 1 summary turn
    expect(done?.reply?.startsWith('[AI] ')).toBe(true);
  });

  it('persists the transcript with AI-labelled assistant messages', async () => {
    const res = await client.get(`/v1/onboarding/sessions/${sessionId}`);
    expect(res.status).toBe(200);
    const { messages } = res.json as unknown as {
      messages: Array<{ role: string; content: string }>;
    };
    const assistant = messages.filter((m) => m.role === 'assistant');
    expect(assistant.length).toBeGreaterThanOrEqual(6); // greeting + turns
    expect(assistant.every((m) => m.content.startsWith('[AI] '))).toBe(true);
    expect(messages.filter((m) => m.role === 'user').length).toBe(6);
  });

  it('confirm is rejected while interview is in progress', async () => {
    const s = await start('en', other);
    const early = await other.req(
      'POST',
      '/v1/onboarding/confirm',
      { sessionId: s.sessionId, confirmed: true },
      other.csrfHeaders(),
    );
    expect(early.status).toBe(409);
  });

  it('confirm after awaiting_confirm flips the profile live', async () => {
    const res = await client.req(
      'POST',
      '/v1/onboarding/confirm',
      { sessionId, confirmed: true },
      client.csrfHeaders(),
    );
    expect(res.status).toBe(200);
    const profile = await client.get('/v1/me/profile');
    expect(
      (profile.json as unknown as { profile: { visibility: string } }).profile.visibility,
    ).toBe('members');
  });

  it('messages to a confirmed session are rejected', async () => {
    const { status } = await postTurn(client, sessionId, 'one more thing?');
    expect(status).toBe(409);
  });
});

describe('onboarding interview (Hindi)', () => {
  it('greets and replies in Hindi with AI label', async () => {
    const s = await start('hi', hindi);
    expect(s.message).toContain('नमस्ते');
    expect(s.message.startsWith('[AI] ')).toBe(true);

    const { status, events } = await postTurn(hindi, s.sessionId, 'मैं इंजीनियर हूँ');
    expect(status).toBe(200);
    const reply = events.at(-1)?.reply ?? '';
    expect(reply.startsWith('[AI] ')).toBe(true);
    // Next scripted topic for hi is a Hindi sentence (non-ASCII).
    expect(/[^\x00-\x7F]/.test(reply)).toBe(true);
  });
});

describe('authz', () => {
  it('anonymous 401; no-CSRF 403; foreign transcript 404', async () => {
    const anon = new TestClient(t.baseUrl);
    expect((await anon.req('POST', '/v1/onboarding/sessions', { locale: 'en' })).status).toBe(401);
    const s = await start('en', client);
    expect(
      (await client.req('POST', '/v1/onboarding/sessions', { locale: 'en' })).status,
    ).toBe(403);
    const foreign = await other.get(`/v1/onboarding/sessions/${s.sessionId}`);
    expect(foreign.status).toBe(404);
  });
});
