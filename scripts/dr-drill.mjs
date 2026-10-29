#!/usr/bin/env node
/**
 * DR restore drill (P5, DESIGN.md §19 exit criterion 2 — restore within RTO;
 * §2.1 RPO 15 min / RTO 4 h).
 *
 * Local harness equivalent of the production runbook (docs/runbooks/
 * dr-restore.md): the cloud path is RDS PITR (point-in-time restore) — not
 * reproducible on a laptop. What IS reproducible here, and what this drill
 * verifies end to end:
 *   1. a backup exists and is CONSISTENT (backup taken from a stopped
 *      instance — the embedded binaries ship no pg_dump/WAL tooling),
 *   2. a fresh instance RESTORES from that backup and serves the data,
 *   3. the measured restore time is within the RTO budget.
 *
 * The drill boots an ephemeral embedded Postgres, migrates it, writes a
 * canary row, stops it, copies the data directory (physical backup),
 * restores a second instance from the copy and verifies the canary. It
 * writes a timestamped evidence JSON to docs/evidence/ and exits non-zero
 * when the RTO budget is breached.
 *
 *   node scripts/dr-drill.mjs
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';

// embedded-postgres is a devDependency of services/api — resolve from there.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(repoRoot, 'services', 'api', 'package.json'));
const EmbeddedPostgresModule = require('embedded-postgres');
const EmbeddedPostgres = EmbeddedPostgresModule.default ?? EmbeddedPostgresModule;
const RTO_MINUTES = Number(process.env.DR_RTO_MINUTES ?? 240); // §2.1: 4 h

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function bootPg(tag) {
  const dir = mkdtempSync(join(tmpdir(), `saath-dr-${tag}-`));
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'saath',
    password: 'saath_dev_password',
    port,
    // stop() must KEEP the data dir — it is the backup source.
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });
  await pg.initialise();
  await pg.start();
  return { pg, dir, port };
}

async function migrateAndSeed(adminUrl) {
  const prismaEntry = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [
    prismaEntry,
    'migrate',
    'deploy',
    '--schema',
    join(repoRoot, 'services', 'api', 'prisma', 'schema.prisma'),
  ], { env: { ...process.env, DATABASE_URL: adminUrl }, stdio: 'pipe' });
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  await db.$executeRawUnsafe(
    `INSERT INTO "users" ("id", "phone_e164_hash", "status", "age_verified", "updated_at")
     VALUES ('11111111-1111-1111-1111-111111111111', 'dr-drill-canary', 'active', true, now())`,
  );
  await db.$disconnect();
}

async function verifyRestore(adminUrl) {
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const users = await db.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "users" WHERE "phone_e164_hash" = 'dr-drill-canary'`,
  );
  const tables = await db.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  await db.$disconnect();
  return { canaryFound: users[0].n === 1, tableCount: tables[0].n };
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), 'saath-drill-'));
  const restoreDir = join(workDir, 'restore');
  console.log(`[dr-drill] RTO budget: ${RTO_MINUTES} min (DESIGN.md §2.1)`);

  // 1. Source instance + canary data.
  const source = await bootPg('source');
  const sourceUrl = `postgresql://saath:saath_dev_password@127.0.0.1:${source.port}/postgres`;
  await migrateAndSeed(sourceUrl);
  console.log(`[dr-drill] source instance up on :${source.port} (migrated + canary)`);

  // 2. Backup: stop for a consistent copy, then restore a second instance.
  const t0 = Date.now();
  await source.pg.stop();
  cpSync(source.dir, restoreDir, { recursive: true });
  const targetPort = await freePort();
  const target = new EmbeddedPostgres({
    databaseDir: restoreDir,
    user: 'saath',
    password: 'saath_dev_password',
    port: targetPort,
    persistent: true,
  });
  // The copied directory is already initialised — start directly (no initdb).
  await target.start();
  const restoreMs = Date.now() - t0;

  // 3. Verify the restored instance serves the data.
  const targetUrl = `postgresql://saath:saath_dev_password@127.0.0.1:${targetPort}/postgres`;
  const check = await verifyRestore(targetUrl);
  await target.stop();

  const withinRto = restoreMs <= RTO_MINUTES * 60_000;
  const evidence = {
    drill: 'restore-within-rto',
    ranAt: new Date().toISOString(),
    method:
      'physical backup copy of a stopped embedded Postgres + fresh-instance restore ' +
      '(local stand-in for the RDS PITR runbook in docs/runbooks/dr-restore.md)',
    rtoMinutesBudget: RTO_MINUTES,
    restoreMs,
    canaryFound: check.canaryFound,
    tableCount: check.tableCount,
    withinRto,
  };

  mkdirSync(join(repoRoot, 'docs', 'evidence'), { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const out = join(repoRoot, 'docs', 'evidence', `dr-drill-${ts}.json`);
  writeFileSync(out, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  console.log(`[dr-drill] evidence → ${out}`);

  rmSync(workDir, { recursive: true, force: true });
  rmSync(source.dir, { recursive: true, force: true });
  rmSync(restoreDir, { recursive: true, force: true });
  process.exit(evidence.canaryFound && withinRto ? 0 : 1);
}

main().catch((err) => {
  console.error('[dr-drill] failed', err);
  process.exit(1);
});
