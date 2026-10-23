/**
 * LLM Gateway v2 tests (P1-05):
 * - SSE stream endpoint proxies deltas, ends with done{traceId}, audits llm_calls
 * - Anthropic tool-use passthrough: tools reach the transport verbatim
 * - /internal/tools/*: scoped agent token verified (signature/expiry), tool
 *   allow-list enforced, user binding enforced (wrong user → 403)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, signupTestUser, type TestClient, type TestApp } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { mintAgentToken } from '../../src/modules/llm-gateway/agent-token';
import type { MockTransport } from '../../src/modules/llm-gateway/transports';
import { seedTaxonomy } from '../../prisma/seed-taxonomy-runner';

const SECRET = 'dev-agent-token-hmac-secret';
const SERVICE = { 'x-internal-token': 'test-internal-token-0123456789' };

let t: TestApp;
let client: TestClient;
let userId: string;

async function sseEvents(path: string, body: unknown, headers: Record<string, string>) {
  const res = await fetch(`${t.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    events: text
      .split('\n\n')
      .filter((s) => s.startsWith('data: '))
      .map((s) => JSON.parse(s.slice(6)) as Record<string, unknown>),
  };
}

beforeAll(async () => {
  t = await bootTestApp();
  const admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
  await seedTaxonomy(admin);
  await admin.$disconnect();
  ({ client, userId } = await signupTestUser(t, '+919100000401'));
});

afterAll(async () => {
  await t.app.close();
});

describe('SSE streaming', () => {
  it('streams deltas then done{traceId}; audit row recorded', async () => {
    const { status, events } = await sseEvents(
      '/v1/internal/llm/stream',
      {
        agent: 'A1-onboarding',
        userId,
        tier: 'small',
        messages: [{ role: 'user', content: 'hello 919100000401' }],
      },
      SERVICE,
    );
    expect(status).toBe(200);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('delta');
    expect(types.at(-1)).toBe('done');
    const done = events.at(-1) as { traceId: string; text: string };
    expect(done.text).toContain('[mock:');

    const admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
    const rows = await admin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n
      FROM llm_calls WHERE trace_id = ${done.traceId}`;
    await admin.$disconnect();
    expect(Number(rows[0]?.n ?? 0)).toBe(1);
  });

  it('requires the service token', async () => {
    const { status } = await sseEvents(
      '/v1/internal/llm/stream',
      { agent: 'A1-onboarding', tier: 'small', messages: [{ role: 'user', content: 'hi' }] },
      {},
    );
    expect(status).toBe(401);
  });
});

describe('tool-use passthrough', () => {
  it('tools array reaches the transport verbatim', async () => {
    const res = await fetch(`${t.baseUrl}/v1/internal/llm/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...SERVICE },
      body: JSON.stringify({
        agent: 'A1-onboarding',
        userId,
        tier: 'mid',
        messages: [{ role: 'user', content: 'save my details' }],
        tools: [
          {
            name: 'save_profile_fields',
            description: 'save profile fields',
            input_schema: { type: 'object', properties: { diet: { type: 'string' } } },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const transport = t.app.get<MockTransport>('LLM_TRANSPORT');
    const call = transport.calls.at(-1);
    expect(call?.tools?.[0]?.name).toBe('save_profile_fields');
    expect(call?.tools?.[0]?.input_schema).toMatchObject({ type: 'object' });
  });
});

describe('agent tool endpoints', () => {
  const tokenFor = (user: string, tools: string[]) =>
    mintAgentToken(SECRET, { agent: 'A1-onboarding', acting_for_user_id: user, tools }, 600);

  it('get_profile_draft: valid token returns the acting user draft', async () => {
    const res = await client.req(
      'POST',
      '/v1/internal/tools/get_profile_draft',
      { userId },
      { 'x-agent-token': tokenFor(userId, ['get_profile_draft']) },
    );
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ profile: null, attributes: [] });
  });

  it('save_profile_fields actually writes (visible via /v1/me/profile)', async () => {
    const res = await client.req(
      'POST',
      '/v1/internal/tools/save_profile_fields',
      { userId, fields: { profession: 'Doctor', diet: 'veg' } },
      { 'x-agent-token': tokenFor(userId, ['save_profile_fields']) },
    );
    expect(res.status).toBe(200);
    const mine = await client.get('/v1/me/profile');
    expect((mine.json as unknown as { profile: { profession: string } }).profile.profession).toBe(
      'Doctor',
    );
  });

  it('save_dealbreakers works with a multi-tool token', async () => {
    const res = await client.req(
      'POST',
      '/v1/internal/tools/save_dealbreakers',
      { userId, dealbreakers: [{ field: 'diet', rule: { op: 'eq', value: 'veg' } }] },
      { 'x-agent-token': tokenFor(userId, ['get_profile_draft', 'save_dealbreakers']) },
    );
    expect(res.status).toBe(200);
  });

  it('get_attribute_definitions is a neutral read (no user binding)', async () => {
    const res = await client.req(
      'POST',
      '/v1/internal/tools/get_attribute_definitions',
      {},
      { 'x-agent-token': tokenFor(userId, ['get_attribute_definitions']) },
    );
    expect(res.status).toBe(200);
    const keys = (res.json as unknown as { key: string }[]).map((a) => a.key);
    expect(keys).toContain('diet');
  });

  it('rejects: missing/garbage/expired token → 401; disallowed tool → 403; wrong user → 403', async () => {
    const missing = await client.req('POST', '/v1/internal/tools/get_profile_draft', { userId }, {});
    expect(missing.status).toBe(401);

    const garbage = await client.req(
      'POST',
      '/v1/internal/tools/get_profile_draft',
      { userId },
      { 'x-agent-token': 'garbage.token' },
    );
    expect(garbage.status).toBe(401);

    const expired = await client.req(
      'POST',
      '/v1/internal/tools/get_profile_draft',
      { userId },
      {
        'x-agent-token': mintAgentToken(
          SECRET,
          { agent: 'A1-onboarding', acting_for_user_id: userId, tools: ['get_profile_draft'] },
          600,
        ).slice(0, -8) + 'AAAAAAAA', // tampered signature
      },
    );
    expect(expired.status).toBe(401);

    const disallowed = await client.req(
      'POST',
      '/v1/internal/tools/save_dealbreakers',
      { userId, dealbreakers: [] },
      { 'x-agent-token': tokenFor(userId, ['get_profile_draft']) },
    );
    expect(disallowed.status).toBe(403);

    const wrongUser = await client.req(
      'POST',
      '/v1/internal/tools/get_profile_draft',
      { userId: '00000000-0000-0000-0000-000000000000' },
      { 'x-agent-token': tokenFor(userId, ['get_profile_draft']) },
    );
    expect(wrongUser.status).toBe(403);
  });
});
