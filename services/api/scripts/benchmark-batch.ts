/**
 * Nightly-batch benchmark (P3-07; P3-12 harness hardening, DESIGN.md §19 exit
 * criterion 3: nightly batch for 100k synthetic users < 2 h).
 *
 * P3-12: streams the runner's stdout live (supervised-run progress), and the
 * API/Postgres teardown runs in a finally block (outer timeouts can no longer
 * strand the ephemeral Postgres data dir). The 100k O(n²) bottleneck itself
 * is fixed in MatchingService.shownCountsFor (per-day cached counts).
 *
 * Boots an ephemeral embedded Postgres + the real Nest app (e2e-serve
 * recipe), seeds N fully synthetic users (deterministic PRNG, §17: never
 * real user data), then runs the REAL Python batch runner
 * (`saath_agents.batch`) against the Core tool surface over HTTP —
 * mock screening-broker transport (deterministic; refused in production)
 * per the plan's documented-scaling-model sanction.
 *
 *   pnpm tsx scripts/benchmark-batch.ts           # BENCH_USERS=1000 smoke
 *   BENCH_USERS=100000 pnpm tsx scripts/benchmark-batch.ts
 *
 * Prints a JSON summary (seed ms, batch ms, per-user ms, counts) and writes
 * it to docs/benchmarks/batch-benchmark-<users>-<ts>.json.
 */
import '../src/load-env'; // .env.local before anything else
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import EmbeddedPostgres from 'embedded-postgres';

import { AppModule } from '../src/app.module';
import { stashRawBody } from '../src/common/raw-body';

const require = createRequire(__filename);

const USERS = Number(process.env.BENCH_USERS ?? 1000);
const BATCH_DATE = process.env.BENCH_BATCH_DATE ?? new Date().toISOString().slice(0, 10);
const WORKERS = Number(process.env.BENCH_WORKERS ?? 8);
const INTERNAL_TOKEN = 'bench-internal-token-0123456789';
const CHUNK = 5000;

// Deterministic PRNG (mulberry32) — reproducible seeds.
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CITIES: [string, number][] = [
  ['mumbai', 0.2], ['delhi', 0.18], ['bengaluru', 0.15], ['hyderabad', 0.1], ['chennai', 0.1],
  ['pune', 0.1], ['jaipur', 0.07], ['kochi', 0.05], ['lucknow', 0.05],
];
const DIETS: [string, number][] = [
  ['veg', 0.6], ['eggetarian', 0.15], ['non_veg', 0.15], ['jain_veg', 0.07], ['vegan', 0.03],
];
const RELIGIONS: [string, number][] = [
  ['hindu', 0.8], ['muslim', 0.08], ['christian', 0.06], ['sikh', 0.04], ['jain', 0.02],
];
const HINDU_COMMUNITIES = [
  'hindu-brahmin', 'hindu-iyer', 'hindu-iyengar', 'hindu-rajput', 'hindu-maratha',
  'hindu-patel', 'hindu-reddy', 'hindu-nair', 'hindu-yadav', 'hindu-kayastha',
];

function pick<T>(rand: () => number, table: [T, number][]): T {
  let r = rand();
  for (const [value, p] of table) {
    if ((r -= p) <= 0) return value;
  }
  return table[table.length - 1]![0];
}

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
  const t0 = Date.now();
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';

  const pgPort = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'saath-bench-pg-'));
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
    [prismaEntry, 'migrate', 'deploy', '--schema', join(__dirname, '..', 'prisma', 'schema.prisma')],
    { env: { ...process.env, DATABASE_URL: adminUrl }, stdio: 'inherit' },
  );

  const { PrismaClient } = require('@prisma/client');
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  await admin.$executeRawUnsafe(`ALTER ROLE app_login LOGIN PASSWORD 'app_login_test_password'`);
  const { seedTaxonomy } = require('../prisma/seed-taxonomy-runner');
  await seedTaxonomy(admin);

  // ---- Seed synthetic users ------------------------------------------------
  const rand = prng(42);
  const seedT0 = Date.now();
  const now = Date.now();
  let seeded = 0;
  for (let base = 0; base < USERS; base += CHUNK) {
    const n = Math.min(CHUNK, USERS - base);
    const users: object[] = [];
    const profiles: object[] = [];
    const prefs: object[] = [];
    const photos: object[] = [];
    const vectors: [string, string][] = [];
    for (let i = 0; i < n; i++) {
      const id = randomUUID();
      const gender = (base + i) % 2 === 0 ? 'female' : 'male';
      const birthYear = 1977 + Math.floor(rand() * 26); // age ~24-49
      const city = pick(rand, CITIES);
      const diet = pick(rand, DIETS);
      const religion = pick(rand, RELIGIONS);
      const community = religion === 'hindu'
        ? HINDU_COMMUNITIES[Math.floor(rand() * HINDU_COMMUNITIES.length)]
        : null;
      const divorced = rand() < 0.12;
      const hasChildren = divorced && rand() < 0.3;
      const restrictDiet = rand() < 0.55;
      const dietOk = restrictDiet
        ? [diet, ...(rand() < 0.5 ? (['veg'] as string[]) : [])].filter(
            (v, idx, arr) => arr.indexOf(v) === idx,
          )
        : [];
      const wantCities = rand() < 0.35;
      const cities = wantCities
        ? [...new Set([city, pick(rand, CITIES), pick(rand, CITIES)])]
        : [];
      const communityFilter = rand() < 0.15;
      const lastActive = new Date(now - Math.floor(rand() * 30 * 86_400_000));

      users.push({
        id,
        phoneHash: `bench-${createHash('sha256').update(`bench-phone-${base + i}`).digest('hex')}`,
        gender,
        locale: 'en',
        status: 'active',
        ageVerified: true,
        birthYear,
        lastActiveAt: lastActive,
        createdAt: new Date(now - Math.floor(rand() * 400) * 86_400_000),
      });
      profiles.push({
        userId: id,
        diet,
        heightCm: 150 + Math.floor(rand() * 46),
        maritalStatus: divorced ? 'divorced' : 'never_married',
        hasChildren,
        cityId: city,
        religionId: religion,
        communityId: community,
        willingToRelocate: rand() < 0.75,
        visibility: 'members',
        verificationTier: 1,
        profileVersion: 1,
      });
      prefs.push({
        userId: id,
        ageMin: 23 + Math.floor(rand() * 5),
        ageMax: 33 + Math.floor(rand() * 7),
        cities,
        relocateOk: rand() < 0.75,
        communityFilter: communityFilter ? { religions: [religion] } : null,
        openToAllCommunities: !communityFilter,
        dietOk,
        maritalOk: divorced ? ['never_married', 'divorced'] : ['never_married'],
        version: 1,
      });
      photos.push({
        userId: id,
        storageKey: `bench-photo-${id}`,
        contentType: 'image/jpeg',
        moderationStatus: 'approved',
      });
      // Deterministic 1024-dim unit-ish embedding (Gaussian, normalised).
      const comps: number[] = new Array(1024);
      let norm = 0;
      for (let d = 0; d < 1024; d++) {
        // Box-Muller
        const u1 = Math.max(rand(), 1e-9);
        const u2 = rand();
        const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        comps[d] = g;
        norm += g * g;
      }
      norm = Math.sqrt(norm) || 1;
      vectors.push([id, `[${comps.map((c) => (c / norm).toFixed(6)).join(',')}]`]);
    }
    await admin.user.createMany({ data: users });
    await admin.profile.createMany({ data: profiles });
    await admin.preference.createMany({ data: prefs });
    await admin.photo.createMany({ data: photos });
    // Embeddings via the Unsupported column: chunked VALUES updates.
    for (let v = 0; v < vectors.length; v += 500) {
      const slice = vectors.slice(v, v + 500);
      const values = slice.map(([id, vec]) => `('${id}'::uuid,'${vec}')`).join(',');
      await admin.$executeRawUnsafe(
        `UPDATE "profiles" AS p SET "embedding" = x.emb::vector FROM (VALUES ${values}) AS x(uid, emb) WHERE p."user_id" = x.uid`,
      );
    }
    seeded += n;
    if (seeded % 20000 < CHUNK) console.log(`[bench] seeded ${seeded}/${USERS}`);
  }
  // Fresh planner statistics after the bulk seed: the migrations ANALYZEd
  // empty tables, and without this the planner misestimates the 100k-row
  // corpus (observed: full-scan plans and P2028 tx timeouts in the 100k
  // benchmark's retrieval step).
  await admin.$executeRawUnsafe('ANALYZE');
  const seedMs = Date.now() - seedT0;
  const dbSize = await admin.$queryRaw<[{ pg_size_pretty: string }]>`
    SELECT pg_size_pretty(pg_database_size(current_database()))`;
  await admin.$disconnect();

  // ---- Boot the real Core API ----------------------------------------------
  const { privateKey, publicKey } = require('node:crypto').generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  process.env.JWT_PRIVATE_KEY_ES256_B64 = Buffer.from(
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
  ).toString('base64');
  process.env.JWT_PUBLIC_KEY_ES256_B64 = Buffer.from(
    publicKey.export({ type: 'spki', format: 'pem' }),
  ).toString('base64');
  process.env.JWT_ISSUER = 'saath-bench';
  process.env.OTP_PEPPER = 'bench-otp-pepper-0123456789ab';
  process.env.FLE_MASTER_KEY_B64 = Buffer.from('bench-fle-key-0123456789abcdef0123456789abcdef').toString('base64');
  process.env.COOKIE_SECURE = 'false';
  process.env.INTERNAL_SERVICE_TOKEN = INTERNAL_TOKEN;
  process.env.AGENT_TOKEN_HMAC_SECRET = 'bench-agent-token-secret-0123456789';
  process.env.WHATSAPP_WEBHOOK_SECRET = 'bench-whatsapp-secret-0123456789';
  process.env.DATABASE_URL = `postgresql://app_login:app_login_test_password@127.0.0.1:${pgPort}/postgres`;

  const apiPort = await freePort();
  let app: INestApplication | undefined;
  let exitCode = 0;
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
    app.use(cookieParser());
    app.setGlobalPrefix('v1');
    stashRawBody(app);
    await app.listen(apiPort, '127.0.0.1');
    console.log(`[bench] Core API on :${apiPort} (pg :${pgPort})`);

    // ---- Run the real Python batch runner ----------------------------------
    // ASYNC spawn with streamed stdio: the Core API lives in THIS process — a
    // sync spawn would freeze the event loop and starve the batch's HTTP calls.
    // The runner's `[batch] done/total ...` progress lines are echoed live so a
    // supervised 100k run is observable; stdout is also accumulated for the
    // final stats JSON (last line).
    const batchT0 = Date.now();
    let stdout = '';
    let stderr = '';
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'uv',
        ['run', 'python', '-m', 'saath_agents.batch', '--date', BATCH_DATE],
        {
          cwd: join(__dirname, '..', '..', 'agents'),
          env: {
            ...process.env,
            CORE_API_URL: `http://127.0.0.1:${apiPort}`,
            INTERNAL_SERVICE_TOKEN: INTERNAL_TOKEN,
            AGENT_TOKEN_SECRET: 'bench-agent-token-secret-0123456789',
            BATCH_WORKERS: String(WORKERS),
            MATCHING_STAGE2_MAX_PER_USER: '30',
            MATCHING_DAILY_PUBLISH_COUNT: '3',
            MATCHING_EXPOSURE_DAILY_CAP: '5',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
        process.stdout.write(d);
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
        process.stderr.write(d);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        exitCode = code ?? 1;
        resolve();
      });
    });
    const batchMs = Date.now() - batchT0;
    if (exitCode !== 0) {
      console.error('[bench] batch failed; stdout head:', stdout.slice(0, 2500));
      console.error('[bench] stderr head:', stderr.slice(0, 2500));
    }
    const stats = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as Record<string, unknown>;

    const summary = {
      benchUsers: USERS,
      batchDate: BATCH_DATE,
      workers: WORKERS,
      seedMs,
      batchMs,
      perUserMs: USERS ? +(batchMs / USERS).toFixed(2) : 0,
      extrapolated100kMinutes: +(((batchMs / USERS) * 100_000) / 60_000).toFixed(1),
      dbSize: dbSize[0]?.pg_size_pretty,
      ...stats,
      exitCode,
    };
    console.log(JSON.stringify(summary, null, 2));

    const outDir = join(__dirname, '..', '..', '..', 'docs', 'benchmarks');
    mkdirSync(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    writeFileSync(
      join(outDir, `batch-benchmark-${USERS}-${ts}.json`),
      JSON.stringify(summary, null, 2),
    );
  } finally {
    // Clean teardown even when the run is aborted mid-batch — supervised 100k
    // runs use multi-hour outer timeouts that can kill this process.
    if (app) await app.close();
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`[bench] total wall ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[bench] failed', err);
  process.exit(1);
});
