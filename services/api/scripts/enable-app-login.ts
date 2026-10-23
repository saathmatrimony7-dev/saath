/** One-off: enable app_login on the persistent dev DB (idempotent). */
import { PrismaClient } from '@prisma/client';

const url =
  process.env.ADMIN_DATABASE_URL ??
  'postgresql://saath:saath_dev_password@127.0.0.1:55433/postgres';

async function main(): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$executeRawUnsafe(`ALTER ROLE app_login LOGIN PASSWORD 'app_login_dev_password'`);
  // Windows: embedded PG defaults client_encoding to WIN1252; force UTF-8 so
  // non-ASCII data (Hindi/Tamil labels) round-trips correctly. Also heal the
  // server encoding on data dirs created before the UTF8 initdb flag (safe
  // while content is ASCII).
  await prisma.$executeRawUnsafe(
    `UPDATE pg_database SET encoding = pg_char_to_encoding('UTF8') WHERE datname = 'postgres' AND encoding <> pg_char_to_encoding('UTF8')`,
  );
  await prisma.$executeRawUnsafe(`ALTER DATABASE postgres SET client_encoding TO 'UTF8'`);
  await prisma.$disconnect();
  console.log('app_login enabled on dev DB');
}

void main();
