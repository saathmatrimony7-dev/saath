/**
 * Vitest global setup: boots an ephemeral embedded Postgres (port 55434),
 * applies migrations with `prisma migrate deploy`, and tears it down after.
 * No Docker required; CI behaves identically.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Superuser connection — used ONLY for migrations and role enablement. */
export const TEST_DATABASE_URL = 'postgresql://saath:saath_dev_password@127.0.0.1:55434/postgres';

/**
 * Non-superuser application connection — all RLS assertions use this.
 * (Superusers bypass RLS unconditionally; testing as superuser proves nothing.)
 */
export const APP_DATABASE_URL =
  'postgresql://app_login:app_login_test_password@127.0.0.1:55434/postgres';

export default async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'saath-pgtest-'));
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'saath',
    password: 'saath_dev_password',
    port: 55434,
    persistent: false,
  });
  try {
    await pg.initialise();
    await pg.start();

    // Invoke Prisma's JS entry directly — .bin shims (.cmd) don't exec cleanly
    // from execFileSync on Windows.
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
      {
        env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
        stdio: 'inherit',
      },
    );
    // Enable the app login role for this ephemeral instance (mirrors what
    // dev-db.ts / docker init / cloud provisioning do outside migrations).
    const { PrismaClient } = await import('@prisma/client');
    const admin = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
    await admin.$executeRawUnsafe(`ALTER ROLE app_login LOGIN PASSWORD 'app_login_test_password'`);
    await admin.$disconnect();
  } catch (err) {
    await pg.stop().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }

  process.env.DATABASE_URL = APP_DATABASE_URL;

  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
