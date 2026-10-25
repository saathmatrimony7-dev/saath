/**
 * RLS integration tests — P0 exit criterion: "RLS tests prove cross-user reads fail".
 * P1 extends the proofs to the new user-data tables (consents, profiles,
 * photos, onboarding sessions/messages) and the append-only consent grant.
 *
 * Runs against the ephemeral embedded Postgres from test/global-setup.ts.
 * Tables have FORCE ROW LEVEL SECURITY, so these prove the database itself
 * (not just the service layer) isolates users.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { getTestDbUrls } from '../helpers/test-db';

// All assertions run as app_login (non-superuser) — the same role the API uses.
const prisma = new RlsPrismaClient({
  datasources: { db: { url: getTestDbUrls().appUrl } },
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

describe('P1 user-data tables — consents, profiles, photos, onboarding', () => {
  let sessionA = '';
  let sessionB = '';

  beforeAll(async () => {
    await prisma.withUser(userA, async (tx) => {
      await tx.profile.create({ data: { userId: userA, displayName: 'A' } });
      await tx.consent.create({
        data: { userId: userA, purpose: 'whatsapp', granted: true, noticeVersion: 'rls-test' },
      });
      const s = await tx.onboardingSession.create({ data: { userId: userA, locale: 'en' } });
      sessionA = s.id;
      await tx.onboardingMessage.create({
        data: { sessionId: s.id, role: 'assistant', content: '[AI] hi', seq: 0 },
      });
      await tx.photo.create({
        data: { userId: userA, storageKey: 'rls-a', contentType: 'image/jpeg' },
      });
    });
    await prisma.withUser(userB, async (tx) => {
      await tx.profile.create({ data: { userId: userB, displayName: 'B' } });
      await tx.consent.create({
        data: { userId: userB, purpose: 'whatsapp', granted: false, noticeVersion: 'rls-test' },
      });
      const s = await tx.onboardingSession.create({ data: { userId: userB, locale: 'hi' } });
      sessionB = s.id;
      await tx.onboardingMessage.create({
        data: { sessionId: s.id, role: 'assistant', content: '[AI] नमस्ते', seq: 0 },
      });
      await tx.photo.create({
        data: { userId: userB, storageKey: 'rls-b', contentType: 'image/jpeg' },
      });
    });
  });

  it('owner reads only their own profile, consents, onboarding and photos', async () => {
    await prisma.withUser(userA, async (tx) => {
      expect(await tx.profile.findMany()).toHaveLength(1);
      expect(await tx.consent.findMany()).toHaveLength(1);
      const sessions = await tx.onboardingSession.findMany();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.id).toBe(sessionA);
      const messages = await tx.onboardingMessage.findMany();
      expect(messages).toHaveLength(1);
      expect(messages[0]?.sessionId).toBe(sessionA);
      expect(await tx.photo.findMany()).toHaveLength(1);
    });
  });

  it('cross-user reads fail: primary key and raw SQL', async () => {
    await prisma.withUser(userA, async (tx) => {
      expect(await tx.profile.findUnique({ where: { userId: userB } })).toBeNull();
      expect(await tx.consent.findFirst({ where: { userId: userB } })).toBeNull();
      expect(await tx.onboardingSession.findUnique({ where: { id: sessionB } })).toBeNull();
      expect(await tx.photo.findFirst({ where: { storageKey: 'rls-b' } })).toBeNull();
      const counts = await tx.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM onboarding_sessions WHERE user_id = ${userB}::uuid`;
      expect(Number(counts[0]?.count)).toBe(0);
    });
  });

  it('cross-user writes fail: update invisible rows and insert into foreign sessions', async () => {
    await expect(
      prisma.withUser(userA, (tx) =>
        tx.onboardingSession.update({ where: { id: sessionB }, data: { status: 'confirmed' } }),
      ),
    ).rejects.toThrow();
    await expect(
      prisma.withUser(userA, (tx) =>
        tx.onboardingMessage.create({
          data: { sessionId: sessionB, role: 'assistant', content: '[AI] injected', seq: 1 },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      prisma.withUser(userA, (tx) => tx.photo.update({ where: { storageKey: 'rls-b' }, data: {} })),
    ).rejects.toThrow();
  });

  it('consent ledger is append-only: no UPDATE/DELETE grants on consents', async () => {
    await prisma.withUser(userA, async (tx) => {
      const row = await tx.consent.findFirstOrThrow({ where: { userId: userA } });
      await expect(
        tx.consent.update({ where: { id: row.id }, data: { granted: false } }),
      ).rejects.toThrow();
      await expect(tx.consent.delete({ where: { id: row.id } })).rejects.toThrow();
    });
  });

  it('webhook_events is operational: insert/select allowed, no UPDATE grant', async () => {
    // No RLS by design (vendor ids only, no user data — ADR-0001 scope).
    await prisma.webhookEvent.create({ data: { id: 'rls-wa-1', source: 'whatsapp' } });
    expect(await prisma.webhookEvent.findUnique({ where: { id: 'rls-wa-1' } })).not.toBeNull();
    await expect(
      prisma.webhookEvent.update({ where: { id: 'rls-wa-1' }, data: { source: 'tampered' } }),
    ).rejects.toThrow();
  });
});

describe('P2 tables — kyc, safety, risk, admin audit', () => {
  let sessionA = '';
  let caseId = '';

  beforeAll(async () => {
    await prisma.withUser(userA, async (tx) => {
      const kyc = await tx.kycCheck.create({
        data: {
          userId: userA,
          provider: 'mock',
          providerRef: 'rls-kyc-a',
          type: 'id_liveness',
          status: 'pass',
          age: 28,
        },
      });
      void kyc;
      await tx.block.create({ data: { blockerId: userA, blockedId: userB } });
      await tx.userReport.create({
        data: { reporterId: userA, subjectId: userB, reason: 'scam' },
      });
      const s = await tx.onboardingSession.create({ data: { userId: userA, locale: 'en' } });
      sessionA = s.id;
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'risk', true)`;
      await tx.riskScore.create({ data: { userId: userA, score: 30, signals: [] } });
      const c = await tx.safetyCase.create({
        data: { subjectId: userB, source: 'risk', severity: 'high' },
      });
      caseId = c.id;
      await tx.adminAudit.create({
        data: { actorId: userA, action: 'admin.view.users', subjectKind: 'user' },
      });
      await tx.adminElevation.create({
        data: {
          userId: userA,
          grantedBy: userA,
          reason: 'rls test',
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
    });
  });

  it('owner reads own kyc_checks and blocks; cross-user denied', async () => {
    await prisma.withUser(userA, async (tx) => {
      expect(await tx.kycCheck.findMany()).toHaveLength(1);
      expect(await tx.block.findMany()).toHaveLength(1);
      expect(await tx.userReport.findMany()).toHaveLength(1); // reporter view
      expect(await tx.riskScore.findUnique({ where: { userId: userA } })).not.toBeNull();
      expect(await tx.adminElevation.findMany()).toHaveLength(1); // own elevation
    });
    await prisma.withUser(userA, async (tx) => {
      expect(await tx.kycCheck.findFirst({ where: { userId: userB } })).toBeNull();
      const counts = await tx.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM kyc_checks WHERE user_id = ${userB}::uuid`;
      expect(Number(counts[0]?.count)).toBe(0);
    });
  });

  it('safety_cases and admin_audit are service-context only (deny by default)', async () => {
    await prisma.withUser(userA, async (tx) => {
      expect(await tx.safetyCase.findMany()).toHaveLength(0);
      expect(await tx.adminAudit.findMany()).toHaveLength(0);
    });
    // Service context sees what it wrote.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'admin', true)`;
      expect(await tx.safetyCase.findMany()).toHaveLength(1);
      expect(await tx.adminAudit.findMany()).toHaveLength(1);
    });
  });

  it('reports and admin_audit are append-only (no UPDATE/DELETE grants)', async () => {
    await prisma.withUser(userA, async (tx) => {
      const report = await tx.userReport.findFirstOrThrow();
      await expect(
        tx.userReport.update({ where: { id: report.id }, data: { status: 'resolved' } }),
      ).rejects.toThrow();
      await expect(tx.userReport.delete({ where: { id: report.id } })).rejects.toThrow();
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'admin', true)`;
      const row = await tx.adminAudit.findFirstOrThrow();
      await expect(tx.adminAudit.delete({ where: { id: row.id } })).rejects.toThrow();
    });
  });

  it('blocked-pair write enforcement: user A cannot block/report as B', async () => {
    await expect(
      prisma.withUser(userA, (tx) =>
        tx.block.create({ data: { blockerId: userB, blockedId: userA } }),
      ),
    ).rejects.toThrow();
    await expect(
      prisma.withUser(userA, (tx) =>
        tx.userReport.create({ data: { reporterId: userB, subjectId: userA, reason: 'scam' } }),
      ),
    ).rejects.toThrow();
  });

  it('admin context cannot touch foreign tables it has no claim on', async () => {
    // 'admin' service context has NO kyc_checks policy grant (verification|risk only).
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'admin', true)`;
      const rows = await tx.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM kyc_checks`;
      expect(Number(rows[0]?.count)).toBe(0);
    });
  });

  it('cross-user onboarding isolation still holds (P1 regression)', async () => {
    await prisma.withUser(userB, async (tx) => {
      expect(await tx.onboardingSession.findUnique({ where: { id: sessionA } })).toBeNull();
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'risk', true)`;
      const c = await tx.safetyCase.findUnique({ where: { id: caseId } });
      expect(c?.subjectId).toBe(userB);
    });
  });
});
