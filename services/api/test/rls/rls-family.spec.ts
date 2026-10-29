/**
 * RLS proofs for Family Mode (P3-10, migration 20261027174500_family):
 * owners and members can each READ their side of accounts_family; NO
 * user-context writes exist at all (invites/accepts are service-only, so
 * a member can never escalate permissions — D7); family_feedback is
 * owner-read and author-read; a bare context sees nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { getTestDbUrls } from '../helpers/test-db';

const prisma = new RlsPrismaClient({
  datasources: { db: { url: getTestDbUrls().appUrl } },
});

const owner = crypto.randomUUID();
const member = crypto.randomUUID();
const outsider = crypto.randomUUID();
const candidate = crypto.randomUUID();

async function serviceTx<T>(fn: (tx: never) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.service', 'family', true)`;
    return fn(tx as never);
  }) as Promise<T>;
}

beforeAll(async () => {
  for (const [id, hash] of [
    [owner, 'hash-fam-o'],
    [member, 'hash-fam-m'],
    [outsider, 'hash-fam-x'],
    [candidate, 'hash-fam-c'],
  ] as const) {
    await prisma.withUser(id, async (tx) => {
      await tx.user.create({ data: { id, phoneHash: `${hash}-${id}`, locale: 'en' } });
    });
  }
  await serviceTx(async (tx) => {
    const account = await (
      tx as unknown as { familyAccount: { create: (a: unknown) => Promise<{ id: string }> } }
    ).familyAccount.create({
      data: {
        profileUserId: owner,
        memberUserId: member,
        relation: 'parent',
        permissions: { view: true, comment: true },
        invitedBy: owner,
        status: 'accepted',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await (
      tx as unknown as { familyFeedback: { create: (a: unknown) => Promise<unknown> } }
    ).familyFeedback.create({
      data: {
        familyAccountId: account.id,
        familyMemberId: member,
        profileUserId: owner,
        candidateId: candidate,
        signal: 'approve',
      },
    });
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('accounts_family RLS (owner/member read, service-only writes)', () => {
  it('owner reads their family rows; the member reads their own rows', async () => {
    await prisma.withUser(owner, async (tx) => {
      const rows = await tx.familyAccount.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.memberUserId).toBe(member);
    });
    await prisma.withUser(member, async (tx) => {
      const rows = await tx.familyAccount.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.profileUserId).toBe(owner);
    });
    await prisma.withUser(outsider, async (tx) => {
      expect(await tx.familyAccount.findMany()).toHaveLength(0);
    });
  });

  it('users cannot write family rows at all (escalation impossible)', async () => {
    // RLS silently no-ops the member's update attempt — permissions intact.
    await prisma.withUser(member, async (tx) => {
      const res = await tx.familyAccount.updateMany({
        where: { memberUserId: member },
        data: { permissions: { view: true, comment: true, contact: true } },
      });
      expect(res.count).toBe(0);
    });
    const row = await serviceTx(async (tx) =>
      (
        tx as unknown as {
          familyAccount: { findFirst: (q: unknown) => Promise<{ permissions: unknown } | null> };
        }
      ).familyAccount.findFirst({ where: { memberUserId: member } }),
    );
    expect(row?.permissions).toEqual({ view: true, comment: true });

    // Direct inserts are denied outright (WITH CHECK fails).
    await expect(
      prisma.withUser(owner, async (tx) => {
        await tx.familyAccount.create({
          data: {
            profileUserId: owner,
            invitedBy: owner,
            relation: 'sibling',
            permissions: { view: true, comment: true },
            status: 'pending',
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        });
      }),
    ).rejects.toThrow();
  });
});

describe('family_feedback RLS (owner + author read, service-only writes)', () => {
  it('owner and author read; outsiders see nothing; bare context nothing', async () => {
    await prisma.withUser(owner, async (tx) => {
      expect(await tx.familyFeedback.findMany()).toHaveLength(1);
    });
    await prisma.withUser(member, async (tx) => {
      expect(await tx.familyFeedback.findMany()).toHaveLength(1);
    });
    await prisma.withUser(outsider, async (tx) => {
      expect(await tx.familyFeedback.findMany()).toHaveLength(0);
    });
    expect(await prisma.familyFeedback.findMany()).toHaveLength(0);
  });

  it('members cannot insert feedback outside the service', async () => {
    await expect(
      prisma.withUser(member, async (tx) => {
        await tx.familyFeedback.create({
          data: {
            familyAccountId: (await tx.familyAccount.findMany())[0]!.id,
            familyMemberId: member,
            profileUserId: owner,
            candidateId: candidate,
            signal: 'reject',
          },
        });
      }),
    ).rejects.toThrow();
  });
});
