/**
 * Starts a persistent local dev Postgres (embedded binaries — no Docker needed)
 * on port 55433 and prints the DATABASE_URL to put in your git-ignored .env.
 * Data lives in services/api/.pgdata (git-ignored). Ctrl+C to stop.
 *
 * If you have Docker, prefer `make db-up` (pgvector image) instead.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { join } from 'node:path';

const port = 55433;
const pg = new EmbeddedPostgres({
  databaseDir: join(__dirname, '..', '.pgdata'),
  user: 'saath',
  password: 'saath_dev_password',
  port,
  persistent: true,
  // Windows hosts would otherwise initdb with the ANSI codepage (WIN1252),
  // which cannot store non-ASCII data (Hindi/Tamil labels). Force UTF8.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

async function main(): Promise<void> {
  await pg.initialise();
  await pg.start();

  // Enable the non-superuser app login role for local dev (idempotent).
  // Cloud environments do this out-of-band with a Secrets Manager password.
  const { PrismaClient } = await import('@prisma/client');
  const admin = new PrismaClient({
    datasources: {
      db: { url: `postgresql://saath:saath_dev_password@127.0.0.1:${port}/postgres` },
    },
  });
  await admin
    .$executeRawUnsafe(`ALTER ROLE app_login LOGIN PASSWORD 'app_login_dev_password'`)
    .catch(() => undefined); // role exists only after first migrate — rerun dev-db after
  // Heal pre-existing data dirs created before the UTF8 initdb flag (initdb
  // only runs on first initialise). Safe while DB content is still ASCII.
  await admin.$executeRawUnsafe(
    `UPDATE pg_database SET encoding = pg_char_to_encoding('UTF8') WHERE datname = 'postgres' AND encoding <> pg_char_to_encoding('UTF8')`,
  );
  await admin.$executeRawUnsafe(`ALTER DATABASE postgres SET client_encoding TO 'UTF8'`);
  await admin.$disconnect();

  console.log(`Postgres ready on port ${port}`);
  console.log('App connection (use this — RLS is enforced):');
  console.log(
    `  DATABASE_URL=postgresql://app_login:app_login_dev_password@127.0.0.1:${port}/postgres`,
  );
  console.log('Admin/migrations connection:');
  console.log(`  DATABASE_URL=postgresql://saath:saath_dev_password@127.0.0.1:${port}/postgres`);
  console.log('Ctrl+C to stop.');

  process.on('SIGINT', async () => {
    await pg.stop();
    process.exit(0);
  });
}

void main();
