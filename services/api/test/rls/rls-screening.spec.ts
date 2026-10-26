/**
 * RLS proofs for screening_results (P3-05, migration
 * 20261026120000_screening_results): SERVICE-CONTEXT-ONLY, mirroring
 * safety_cases — the pair members must never read their own screening rows
 * (verdicts surface through daily_matches under the stricter disclosure
 * policy, §7.4.3). Preferences-family reads in the 'screening' service
 * context ride the generic service policies from 20261023120000.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { getTestDbUrls } from '../helpers/test-db';

const prisma = new RlsPrismaClient({
  datasources: { db: { url: getTestDbUrls().appUrl } },
});

const userA = crypto.randomUUID();
const userB = crypto.randomUUID();

beforeAll(async () => {
  await prisma.withUser(userA, async (tx) => {
    await tx.user.create({ data: { id: userA, phoneHash: `hash-scr-a-${userA}`, locale: 'en' } });
    await tx.profile.create({ data: { userId: userA, displayName: 'SA' } });
    await tx.preference.create({ data: { userId: userA } });
  });
  await prisma.withUser(userB, async (tx) => {
    await tx.user.create({ data: { id: userB, phoneHash: `hash-scr-b-${userB}`, locale: 'hi' } });
    await tx.profile.create({ data: { userId: userB, displayName: 'SB' } });
    await tx.preference.create({ data: { userId: userB } });
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('screening_results is service-context-only (mirror safety_cases)', () => {
  it('owner context cannot read screening rows (neither party)', async () => {
    // Seed a row through the service context first (see next test), then try
    // to read it as each owner: both must see nothing.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'screening', true)`;
      await tx.screeningResult.create({
        data: {
          userA,
          userB,
          prefVersionA: 1,
          prefVersionB: 1,
          verdict: 'COMPATIBLE',
          score: 0.9,
          topics: [],
          reasonCodes: [],
          modelVersion: 'a6-screen-v1',
          inputsHash: 'a'.repeat(64),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
    });
    for (const uid of [userA, userB]) {
      await prisma.withUser(uid, async (tx) => {
        expect(await tx.screeningResult.findMany()).toHaveLength(0);
        expect(
          await tx.screeningResult.findUnique({ where: { userA_userB: { userA, userB } } }),
        ).toBeNull();
      });
    }
  });

  it('owner context cannot insert screening rows', async () => {
    await expect(
      prisma.withUser(userA, async (tx) => {
        await tx.screeningResult.create({
          data: {
            userA,
            userB,
            prefVersionA: 9,
            prefVersionB: 9,
            verdict: 'INCOMPATIBLE',
            score: 0,
            topics: [],
            reasonCodes: ['AGE'],
            modelVersion: 'a6-screen-v1',
            inputsHash: 'b'.repeat(64),
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        });
      }),
    ).rejects.toThrow();
  });

  it('service context can read + write; no context sees nothing', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'screening', true)`;
      const rows = await tx.screeningResult.findMany({ where: { userA } });
      expect(rows.length).toBeGreaterThan(0);
    });
    const bare = await prisma.screeningResult.findMany();
    expect(bare).toHaveLength(0);
  });
});
