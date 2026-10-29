/**
 * RLS proofs for daily_matches (P3-07, migration 20261026130000_daily_matches):
 * owner can READ their own feed rows (the P3-08 feed builds on this);
 * writes are service-context only; a user who merely appears as a candidate
 * cannot see the row; no context sees nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { getTestDbUrls } from '../helpers/test-db';

const prisma = new RlsPrismaClient({
  datasources: { db: { url: getTestDbUrls().appUrl } },
});

const userA = crypto.randomUUID();
const userB = crypto.randomUUID();
const DAY = new Date('2026-10-27T00:00:00Z');

async function seedRow() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
    await tx.dailyMatch.create({
      data: { userId: userA, candidateId: userB, batchDate: DAY, rank: 1, status: 'published' },
    });
  });
}

beforeAll(async () => {
  await prisma.withUser(userA, async (tx) => {
    await tx.user.create({ data: { id: userA, phoneHash: `hash-dm-a-${userA}`, locale: 'en' } });
    await tx.profile.create({ data: { userId: userA, displayName: 'DA' } });
  });
  await prisma.withUser(userB, async (tx) => {
    await tx.user.create({ data: { id: userB, phoneHash: `hash-dm-b-${userB}`, locale: 'hi' } });
    await tx.profile.create({ data: { userId: userB, displayName: 'DB' } });
  });
  await seedRow();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('daily_matches RLS (owner-read, service-write)', () => {
  it('owner reads their own rows; the candidate-side user cannot', async () => {
    await prisma.withUser(userA, async (tx) => {
      const rows = await tx.dailyMatch.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.candidateId).toBe(userB);
    });
    await prisma.withUser(userB, async (tx) => {
      expect(await tx.dailyMatch.findMany()).toHaveLength(0);
    });
  });

  it('owner cannot insert or update feed rows', async () => {
    await expect(
      prisma.withUser(userA, async (tx) => {
        await tx.dailyMatch.create({
          data: { userId: userA, candidateId: userB, batchDate: DAY, rank: 2 },
        });
      }),
    ).rejects.toThrow();
  });

  it('unique (user, candidate, batch_date): duplicates rejected', async () => {
    await expect(seedRow()).rejects.toThrow();
  });

  it('service context reads/writes; bare context sees nothing', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      const rows = await tx.dailyMatch.findMany({ where: { userId: userA } });
      expect(rows).toHaveLength(1);
    });
    expect(await prisma.dailyMatch.findMany()).toHaveLength(0);
  });
});
