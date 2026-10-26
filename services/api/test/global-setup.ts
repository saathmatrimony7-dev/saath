/**
 * Vitest global setup: boots an ephemeral embedded Postgres on a FREE port,
 * applies migrations with `prisma migrate deploy`, enables the app_login role,
 * and tears everything down after. No Docker required; CI behaves identically.
 *
 * Connection URLs are written to a temp file (worker processes can't see this
 * process's env) — read them via test/helpers/test-db.ts.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const require = createRequire(__filename);

// P3-01 (ADR-0012): pgvector for the embedded binaries — no-op when already
// installed; fails with build instructions when the one-time local build is
// missing (migrations need CREATE EXTENSION vector).
const { installPgvectorEmbedded } = require('../../../scripts/install-pgvector-embedded.cjs');
installPgvectorEmbedded();

/** File where the ephemeral DB URLs are published for test workers. */
export const TEST_DB_URL_FILE = join(tmpdir(), 'saath-test-db-urls.json');

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

export default async function setup() {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'saath-pgtest-'));
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'saath',
    password: 'saath_dev_password',
    port,
    persistent: false,
    // Windows hosts would otherwise initdb with the ANSI codepage (WIN1252),
    // which cannot store non-ASCII data (Hindi/Tamil labels). Force UTF8.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  try {
    await pg.initialise();
    await pg.start();

    const adminUrl = `postgresql://saath:saath_dev_password@127.0.0.1:${port}/postgres`;

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
        env: { ...process.env, DATABASE_URL: adminUrl },
        stdio: 'inherit',
      },
    );

    // Enable the app login role for this ephemeral instance (mirrors what
    // dev-db.ts / docker init / cloud provisioning do outside migrations).
    const { PrismaClient } = require('@prisma/client');
    const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    await admin.$executeRawUnsafe(`ALTER ROLE app_login LOGIN PASSWORD 'app_login_test_password'`);

    await admin.$disconnect();

    const appUrl = `postgresql://app_login:app_login_test_password@127.0.0.1:${port}/postgres`;
    writeFileSync(TEST_DB_URL_FILE, JSON.stringify({ adminUrl, appUrl }));
  } catch (err) {
    await pg.stop().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }

  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(TEST_DB_URL_FILE, { force: true });
  };
}
