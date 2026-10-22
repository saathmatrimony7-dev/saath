/** One-off: enable app_login on the persistent dev DB (idempotent). */
import { PrismaClient } from '@prisma/client';

const url =
  process.env.ADMIN_DATABASE_URL ??
  'postgresql://saath:saath_dev_password@127.0.0.1:55433/postgres';

async function main(): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$executeRawUnsafe(`ALTER ROLE app_login LOGIN PASSWORD 'app_login_dev_password'`);
  await prisma.$disconnect();
  console.log('app_login enabled on dev DB');
}

void main();
