/**
 * RLS proofs for the 'matching' service context (P3-03,
 * migration 20261025221000_matching_user_lookup):
 * - users: the service lookup policy allows cross-user reads by id in the
 *   'matching' context (identity, channels, safety already there).
 * - profiles / preferences / blocks / photos: generic service-context policy
 *   (app.service non-empty) already covers 'matching' — proven here, unchanged.
 * - owner context is unchanged: cross-user reads still return nothing.
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
    await tx.user.create({ data: { id: userA, phoneHash: `hash-ma-${userA}`, locale: 'en' } });
    await tx.profile.create({ data: { userId: userA, displayName: 'MA' } });
    await tx.preference.create({
      data: { userId: userA, ageMin: 25, ageMax: 35, dietOk: ['veg'] },
    });
    await tx.photo.create({
      data: { userId: userA, storageKey: `rls-match-${userA}`, contentType: 'image/jpeg' },
    });
  });
  await prisma.withUser(userB, async (tx) => {
    await tx.user.create({ data: { id: userB, phoneHash: `hash-mb-${userB}`, locale: 'hi' } });
    await tx.profile.create({ data: { userId: userB, displayName: 'MB' } });
    await tx.preference.create({
      data: { userId: userB, ageMin: 20, ageMax: 40, dietOk: ['vegan'] },
    });
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('matching service context (app.service = matching)', () => {
  it('cross-user read of a users row is allowed by the lookup policy', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      const row = await tx.user.findUnique({ where: { id: userB } });
      expect(row?.id).toBe(userB);
    });
  });

  it('cross-user reads of profiles / preferences / photos / blocks are allowed', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      expect((await tx.profile.findUnique({ where: { userId: userB } }))?.displayName).toBe('MB');
      expect((await tx.preference.findUnique({ where: { userId: userB } }))?.ageMin).toBe(20);
      expect(
        (await tx.photo.findFirst({ where: { userId: userA } }))?.storageKey,
      ).toBe(`rls-match-${userA}`);
      // Blocks: both directions are readable (needed for pool exclusion).
      await tx.block.create({ data: { blockerId: userA, blockedId: userB } });
      const found = await tx.block.findFirst({
        where: {
          OR: [
            { blockerId: userA, blockedId: userB },
            { blockerId: userB, blockedId: userA },
          ],
        },
      });
      expect(found).not.toBeNull();
      await tx.block.deleteMany({ where: { blockerId: userA, blockedId: userB } });
    });
  });

  it('a DIFFERENT service context still cannot use the matching grant', async () => {
    // 'matching' was appended to the users lookup IN-list, not a wildcard:
    // an unrelated context (e.g. 'moderation') must not read users by id.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'moderation', true)`;
      expect(await tx.user.findUnique({ where: { id: userB } })).toBeNull();
    });
  });
});

describe('owner context unchanged (regression)', () => {
  it('user A still cannot read user B (users row, profile, preference)', async () => {
    await prisma.withUser(userA, async (tx) => {
      expect(await tx.user.findUnique({ where: { id: userB } })).toBeNull();
      expect(await tx.profile.findUnique({ where: { userId: userB } })).toBeNull();
      expect(await tx.preference.findUnique({ where: { userId: userB } })).toBeNull();
      const counts = await tx.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM users WHERE id = ${userB}::uuid`;
      expect(Number(counts[0]?.count)).toBe(0);
    });
  });

  it('no context at all still returns zero rows', async () => {
    const rows = await prisma.$queryRaw<unknown[]>`
      SELECT * FROM profiles WHERE user_id = ${userB}::uuid`;
    expect(rows).toHaveLength(0);
  });
});
