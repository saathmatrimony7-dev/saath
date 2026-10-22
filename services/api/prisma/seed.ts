/**
 * Seed script — SYNTHETIC DATA ONLY (AGENTS.md rule 1, DESIGN.md §15).
 * Inserts a handful of fake users + sessions through the RLS-aware client
 * (inserts respect WITH CHECK policies, so each insert runs under its owner).
 *
 * Usage: DATABASE_URL=... pnpm db:seed
 */
import { randomUUID, createHash } from 'node:crypto';
import { RlsPrismaClient } from '../src/prisma/rls-prisma.client';

const prisma = new RlsPrismaClient();

// Fake phone numbers in the ITU-T test range (+91 555 ...), hashed — never plaintext.
const SYNTHETIC_USERS = [
  { gender: 'female', locale: 'en', birthYear: 1997 },
  { gender: 'male', locale: 'hi', birthYear: 1994 },
  { gender: 'female', locale: 'ta', birthYear: 1999 },
] as const;

async function main(): Promise<void> {
  for (const [i, u] of SYNTHETIC_USERS.entries()) {
    const id = randomUUID();
    const fakePhone = `+91555000${String(1000 + i)}`;
    const phoneHash = createHash('sha256').update(fakePhone).digest('hex');

    await prisma.withUser(id, async (tx) => {
      await tx.user.create({
        data: {
          id,
          phoneHash,
          gender: u.gender,
          locale: u.locale,
          birthYear: u.birthYear,
          ageVerified: true,
        },
      });
      await tx.session.create({
        data: {
          userId: id,
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
