/**
 * Seed script — SYNTHETIC DATA ONLY (AGENTS.md rule 1, DESIGN.md §15).
 *
 * Two connections:
 *  - ADMIN (superuser): taxonomy reference data (app role is SELECT-only there)
 *  - app_login: synthetic users/sessions through RLS-checked inserts
 *
 * Usage: DATABASE_URL=postgresql://app_login:... ADMIN_DATABASE_URL=postgresql://saath:... pnpm db:seed
 */
import { createHash } from 'node:crypto';
import { RlsPrismaClient } from '../src/prisma/rls-prisma.client';
import { seedTaxonomy } from './seed-taxonomy-runner';

const prisma = new RlsPrismaClient();

// Fake phone numbers in the ITU-T test range (+91 555 ...), hashed — never plaintext.
const SYNTHETIC_USERS = [
  { gender: 'female', locale: 'en', birthYear: 1997 },
  { gender: 'male', locale: 'hi', birthYear: 1994 },
  { gender: 'female', locale: 'ta', birthYear: 1999 },
] as const;

async function main(): Promise<void> {
  // Reference data via the admin connection (RLS-free by role, not by policy).
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  if (adminUrl) {
    const admin = new RlsPrismaClient({ datasources: { db: { url: adminUrl } } });
    await seedTaxonomy(admin);
    await admin.$disconnect();
  } else {
    console.log('ADMIN_DATABASE_URL not set — skipping taxonomy seed');
  }

  for (const [i, u] of SYNTHETIC_USERS.entries()) {
    const fakePhone = `+91555000${String(1000 + i)}`;
    const phoneHash = createHash('sha256').update(fakePhone).digest('hex');

    // Idempotent: deterministic UUID per index so re-runs don't blow up (P2002).
    const h = createHash('sha256').update(`seed-user-${i}`).digest('hex').slice(0, 32);
    const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    await prisma.withUser(id, async (tx) => {
      const user = await tx.user.upsert({
        where: { id },
        create: {
          id,
          phoneHash,
          gender: u.gender,
          locale: u.locale,
          birthYear: u.birthYear,
          ageVerified: true,
        },
        update: { gender: u.gender, locale: u.locale, birthYear: u.birthYear },
      });
      // NB: the app role has no DELETE grant (service-only writes), so reruns
      // append extra session rows — harmless synthetic dev data.
      await tx.session.create({
        data: {
          userId: user.id,
          refreshTokenHash: createHash('sha256').update(`seed-rt-${id}`).digest('hex'),
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        },
      });
    });
    console.log(`seeded synthetic user ${id} (${u.locale})`);
  }
  console.log('seed complete (synthetic data only)');
}

void main().finally(() => prisma.$disconnect());
