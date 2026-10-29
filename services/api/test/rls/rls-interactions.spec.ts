/**
 * RLS proofs for interactions (P3-08, migration 20261026233000_interactions):
 * the ACTOR can read their own disposition rows; the TARGET user cannot see
 * who liked/passed them (reveal only via mutual match, P4); writes are
 * service-context only; unique (actor, target, type); the pass-reason
 * CHECK rejects vocabulary violations at the DB level.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Prisma } from '@prisma/client';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { getTestDbUrls } from '../helpers/test-db';

const prisma = new RlsPrismaClient({
  datasources: { db: { url: getTestDbUrls().appUrl } },
});

const actor = crypto.randomUUID();
const target = crypto.randomUUID();
const bystander = crypto.randomUUID();

async function serviceTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.service', 'interactions', true)`;
    return fn(tx);
  });
}

async function seedLike() {
  await serviceTx((tx) =>
    tx.interaction.create({
      data: { actorUserId: actor, targetUserId: target, type: 'like' },
    }),
  );
}

beforeAll(async () => {
  for (const [id, hash] of [
    [actor, 'hash-int-a'],
    [target, 'hash-int-b'],
    [bystander, 'hash-int-c'],
  ] as const) {
    await prisma.withUser(id, async (tx) => {
      await tx.user.create({ data: { id, phoneHash: `${hash}-${id}`, locale: 'en' } });
    });
  }
  await seedLike();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('interactions RLS (actor-read, service-write)', () => {
  it('actor reads their own rows; the target and bystanders see nothing', async () => {
    await prisma.withUser(actor, async (tx) => {
      const rows = await tx.interaction.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.targetUserId).toBe(target);
    });
    await prisma.withUser(target, async (tx) => {
      expect(await tx.interaction.findMany()).toHaveLength(0);
    });
    await prisma.withUser(bystander, async (tx) => {
      expect(await tx.interaction.findMany()).toHaveLength(0);
    });
  });

  it('owner cannot insert rows (service-context writes only)', async () => {
    await expect(
      prisma.withUser(actor, async (tx) => {
        await tx.interaction.create({
          data: { actorUserId: actor, targetUserId: bystander, type: 'shortlist' },
        });
      }),
    ).rejects.toThrow();
  });

  it('unique (actor, target, type): duplicates rejected', async () => {
    await expect(seedLike()).rejects.toThrow();
  });

  it('pass reason_code CHECK rejects out-of-vocabulary values', async () => {
    await expect(
      serviceTx((tx) =>
        tx.interaction.create({
          data: {
            actorUserId: actor,
            targetUserId: target,
            type: 'pass',
            reasonCode: 'free_text_insult',
          },
        }),
      ),
    ).rejects.toThrow();
    // In-vocabulary value is accepted.
    await serviceTx((tx) =>
      tx.interaction.create({
        data: {
          actorUserId: actor,
          targetUserId: bystander,
          type: 'pass',
          reasonCode: 'not_interested',
        },
      }),
    );
  });

  it('service context reads all rows; a bare context sees nothing', async () => {
    const rows = await serviceTx((tx) => tx.interaction.findMany());
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(await prisma.interaction.findMany()).toHaveLength(0);
  });
});
