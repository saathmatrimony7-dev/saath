/**
 * Boots the NestJS app against the ephemeral test Postgres (global-setup.ts)
 * with generated ephemeral keys. No secrets, no external services:
 * SMS uses the MockSmsProvider in-memory outbox.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import type { MockSmsProvider } from '../../src/modules/identity/sms/sms-provider';
import { SMS_PROVIDER } from '../../src/modules/identity/tokens';
import { getTestDbUrls } from './test-db';

export interface TestApp {
  app: INestApplication;
  baseUrl: string;
  mockSms: MockSmsProvider;
}

export async function bootTestApp(): Promise<TestApp> {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  process.env.JWT_PRIVATE_KEY_ES256_B64 = Buffer.from(
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
  ).toString('base64');
  process.env.JWT_PUBLIC_KEY_ES256_B64 = Buffer.from(
    publicKey.export({ type: 'spki', format: 'pem' }),
  ).toString('base64');
  process.env.JWT_ISSUER = 'saath-test';
  process.env.OTP_PEPPER = randomBytes(16).toString('hex');
  process.env.FLE_MASTER_KEY_B64 = randomBytes(32).toString('base64');
  process.env.COOKIE_SECURE = 'false';
  process.env.OTP_PROVIDER = 'mock';
  process.env.OTP_IP_REQUESTS_PER_HOUR = '100000'; // tests share 127.0.0.1
  process.env.INTERNAL_SERVICE_TOKEN ??= 'test-internal-token-0123456789';
  // Point Prisma at the ephemeral test DB (app_login — RLS enforced).
  process.env.DATABASE_URL = getTestDbUrls().appUrl;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.setGlobalPrefix('v1');
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address() as { port: number };
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    mockSms: app.get<MockSmsProvider>(SMS_PROVIDER),
  };
}

/** Minimal cookie-aware fetch client. */
export class TestClient {
  readonly cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  async req(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; json: Record<string, unknown> | null }> {
    const cookieHeader = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Capture set-cookie headers (name=value pairs).
    for (const sc of res.headers.getSetCookie()) {
      const pair = sc.split(';')[0];
      if (!pair) continue;
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }

    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }

  get(path: string, headers?: Record<string, string>) {
    return this.req('GET', path, undefined, headers);
  }
  post(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.req('POST', path, body, headers);
  }
  put(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.req('PUT', path, body, headers);
  }
  patch(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.req('PATCH', path, body, headers);
  }

  /** CSRF double-submit header from the cookie jar. */
  csrfHeaders(): Record<string, string> {
    const csrf = this.cookies.get('saath_csrf');
    return csrf ? { 'x-csrf-token': csrf } : {};
  }
}

/** Signs up a fresh user through the full OTP flow; returns authed client + id. */
export async function signupTestUser(
  t: TestApp,
  phone: string,
): Promise<{ client: TestClient; userId: string }> {
  const client = new TestClient(t.baseUrl);
  const req = await client.post('/v1/auth/otp/request', { phone });
  if (req.status !== 202) throw new Error(`otp request failed: ${req.status}`);
  const code = t.mockSms.outbox.at(-1)?.code;
  if (!code) throw new Error('mock outbox empty');
  const res = await client.post('/v1/auth/otp/verify', { phone, code });
  if (res.status !== 200) throw new Error(`otp verify failed: ${res.status}`);
  return { client, userId: res.json?.userId as string };
}
