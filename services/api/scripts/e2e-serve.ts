/**
 * Standalone Core API server for Playwright e2e (P1-08).
 *
 * Boots an ephemeral embedded Postgres (same recipe as test/global-setup.ts),
 * applies migrations, and serves the Nest app on E2E_PORT (default 3100) with
 * the scripted onboarding engine and mock SMS provider — the exact mocks the
 * Vitest e2e specs use, exposed over HTTP for the web e2e.
 *
 * Test-only hook: GET /__e2e/otp returns the latest mock OTP code so the
 * browser e2e can complete login. This process is dev/test tooling only and
 * must never be deployed (it is refused in production, see config.ts).
 */
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import EmbeddedPostgres from 'embedded-postgres';

import { AppModule } from '../src/app.module';
import { stashRawBody } from '../src/common/raw-body';
import type { MockSmsProvider } from '../src/modules/identity/sms/sms-provider';
import { SMS_PROVIDER } from '../src/modules/identity/tokens';

const require = createRequire(__filename);
const PORT = Number(process.env.E2E_PORT ?? 3100);

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function main() {
  const pgPort = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'saath-e2e-pg-'));
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'saath',
    password: 'saath_dev_password',
    port: pgPort,
    persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });
  await pg.initialise();
  await pg.start();

  const adminUrl = `postgresql://saath:saath_dev_password@127.0.0.1:${pgPort}/postgres`;

  const prismaEntry = require.resolve('prisma/build/index.js');
  execFileSync(
    process.execPath,
    [
      prismaEntry,
      'migrate',
      'deploy',
      '--schema',
      join(__dirname, '..', 'prisma', 'schema.prisma'),
    ],
    { env: { ...process.env, DATABASE_URL: adminUrl }, stdio: 'inherit' },
  );

  const { PrismaClient } = require('@prisma/client');
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  await admin.$executeRawUnsafe(`ALTER ROLE app_login LOGIN PASSWORD 'app_login_test_password'`);
  await admin.$disconnect();

  // Ephemeral keys + mock vendors (identical to test/helpers/test-app.ts).
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  process.env.JWT_PRIVATE_KEY_ES256_B64 = Buffer.from(
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
  ).toString('base64');
  process.env.JWT_PUBLIC_KEY_ES256_B64 = Buffer.from(
    publicKey.export({ type: 'spki', format: 'pem' }),
  ).toString('base64');
  process.env.JWT_ISSUER = 'saath-e2e';
  process.env.OTP_PEPPER = randomBytes(16).toString('hex');
  process.env.FLE_MASTER_KEY_B64 = randomBytes(32).toString('base64');
  process.env.COOKIE_SECURE = 'false';
  process.env.OTP_PROVIDER = 'mock';
  process.env.OTP_IP_REQUESTS_PER_HOUR = '100000';
  process.env.ONBOARDING_MAX_TURNS = process.env.ONBOARDING_MAX_TURNS ?? '5';
  process.env.INTERNAL_SERVICE_TOKEN = 'e2e-internal-token-0123456789';
  process.env.WHATSAPP_WEBHOOK_SECRET ??= 'test-whatsapp-webhook-secret-0123456789';
  process.env.DATABASE_URL = `postgresql://app_login:app_login_test_password@127.0.0.1:${pgPort}/postgres`;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
  app.use(cookieParser());
  app.setGlobalPrefix('v1');
  stashRawBody(app);

  // Test-only OTP read-back for the browser e2e (mock provider, mock codes).
  const mockSms = app.get<MockSmsProvider>(SMS_PROVIDER);
  const expressApp = app.getHttpAdapter().getInstance() as {
    get: (path: string, handler: (req: unknown, res: unknown) => void) => void;
  };
  expressApp.get('/__e2e/otp', (_req, res) => {
    (res as { json: (body: unknown) => void }).json({ code: mockSms.outbox.at(-1)?.code ?? null });
  });

  await app.listen(PORT, '127.0.0.1');
  console.log(`[e2e-serve] Core API ready on http://127.0.0.1:${PORT} (pg :${pgPort})`);

  const shutdown = async () => {
    await app.close();
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('[e2e-serve] boot failed', err);
  process.exit(1);
});
