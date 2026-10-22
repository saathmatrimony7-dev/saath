/**
 * RLS integration tests — P0 exit criterion: "RLS tests prove cross-user reads fail".
 *
 * Runs against the ephemeral embedded Postgres from test/global-setup.ts.
 * Tables have FORCE ROW LEVEL SECURITY, so these prove the database itself
 * (not just the service layer) isolates users.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { APP_DATABASE_URL } from '../global-setup';

// All assertions run as app_login (non-superuser) — the same role the API uses.
const prisma = new RlsPrismaClient({
  datasources: { db: { url: APP_DATABASE_URL } },
});

const userA = crypto.randomUUID();
const userB = crypto.randomUUID();

beforeAll(async () => {
  // Seed through the RLS-aware helper (inserts are also policy-checked).
  await prisma.withUser(userA, async (tx) => {
    await tx.user.create({
      data: { id: userA, phoneHash: `hash-a-${userA}`, locale: 'en' },
    });
    await tx.session.create({
      data: {
        userId: userA,
        refreshTokenHash: 'rt-hash-a',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
  });
  await prisma.withUser(userB, async (tx) => {
    await tx.user.create({
      data: { id: userB, phoneHash: `hash-b-${userB}`, locale: 'hi' },
    });
    await tx.session.create({
      data: {
        userId: userB,
        refreshTokenHash: 'rt-hash-b',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('deny by default', () => {
  it('returns zero rows when app.current_user_id is not set', async () => {
    const rows = await prisma.$queryRaw<unknown[]>`SELECT * FROM users`;
    expect(rows).toHaveLength(0);
    const sessions = await prisma.$queryRaw<unknown[]>`SELECT * FROM sessions`;
    expect(sessions).toHaveLength(0);
  });
});

describe('owner access', () => {
  it('user A reads only their own row', async () => {
    await prisma.withUser(userA, async (tx) => {
      const users = await tx.user.findMany();
      expect(users).toHaveLength(1);
      expect(users[0]?.id).toBe(userA);
    });
  });

  it('user A reads only their own sessions', async () => {
    await prisma.withUser(userA, async (tx) => {
      const sessions = await tx.session.findMany();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.userId).toBe(userA);
    });
  });
});

describe('cross-user isolation', () => {
  it('user A cannot read user B by primary key', async () => {
    await prisma.withUser(userA, async (tx) => {
      const row = await tx.user.findUnique({ where: { id: userB } });
      expect(row).toBeNull();
    });
  });

  it('user A cannot see user B in raw SQL either', async () => {
    await prisma.withUser(userA, async (tx) => {
      const rows = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT count(*)::int AS count FROM users WHERE id = ${userB}::uuid`;
      expect(Number(rows[0]?.count)).toBe(0);
    });
  });

  it('user A cannot update user B (row invisible → P2025)', async () => {
    await expect(
      prisma.withUser(userA, (tx) =>
        tx.user.update({ where: { id: userB }, data: { locale: 'ta' } }),
      ),
    ).rejects.toThrow();
  });

  it('user A cannot insert a row with user B id (WITH CHECK violation)', async () => {
    await expect(
      prisma.withUser(userA, (tx) => tx.user.create({ data: { id: userB, phoneHash: 'hijack' } })),
    ).rejects.toThrow();
  });

  it('user A cannot read user B sessions via raw SQL', async () => {
    await prisma.withUser(userA, async (tx) => {
      const rows = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT count(*)::int AS count FROM sessions WHERE user_id = ${userB}::uuid`;
      expect(Number(rows[0]?.count)).toBe(0);
    });
  });
});
