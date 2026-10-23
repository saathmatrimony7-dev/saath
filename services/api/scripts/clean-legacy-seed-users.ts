/**
 * One-time cleanup: removes pre-P1-01 synthetic seed users (random UUIDs,
 * phones +915550001000..1009) from a dev DB so the now-deterministic
 * idempotent seed can run. Admin connection bypasses RLS. Synthetic data only.
 */
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const url =
  process.env.ADMIN_DATABASE_URL ??
  'postgresql://saath:saath_dev_password@127.0.0.1:55433/postgres';

async function main(): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const hashes = Array.from({ length: 10 }, (_, i) =>
    createHash('sha256').update(`+91555000${String(1000 + i)}`).digest('hex'),
  );
  const sessions = await prisma.$executeRawUnsafe(
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE phone_e164_hash IN (${hashes.map((h) => `'${h}'`).join(',')}))`,
  );
  const users = await prisma.$executeRawUnsafe(
    `DELETE FROM users WHERE phone_e164_hash IN (${hashes.map((h) => `'${h}'`).join(',')})`,
  );
  await prisma.$disconnect();
  console.log(`deleted ${users} synthetic users, ${sessions} sessions`);
}

void main();
