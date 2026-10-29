/**
 * P5-01 DPDP flows: data export (access), account deletion (erasure +
 * retention sweep), grievance filing + officer queue (DESIGN.md §10.2, §2.2).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, signupTestUser, TestClient, type TestApp } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { PrivacyService } from '../../src/modules/privacy/privacy.service';
import { seedTaxonomy } from '../../prisma/seed-taxonomy-runner';

let t: TestApp;
let admin: RlsPrismaClient;
let seq = 11100;

async function mkUser() {
  seq += 1;
  const { client, userId } = await signupTestUser(t, `+9122${String(seq).padStart(8, '0')}`);
  await admin.user.update({
    where: { id: userId },
    data: { ageVerified: true, birthYear: new Date().getFullYear() - 28, status: 'active' },
  });
  const pr = await client.patch(
    '/v1/me/profile',
    { cityId: 'mumbai', diet: 'veg', heightCm: 170, maritalStatus: 'never_married' },
    client.csrfHeaders(),
  );
  expect(pr.status).toBe(200);
  return { client, userId };
}

/** A conversation with one message, created directly in the DB. */
async function seedConversation(userA: string, userB: string, body: string) {
  const [lo, hi] = userA < userB ? [userA, userB] : [userB, userA];
  const { FieldCrypto, EnvKeyProvider } = await import('@saath/crypto');
  const crypto = new FieldCrypto(new EnvKeyProvider());
  return admin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.service', 'messaging', true)`;
    const conv = await tx.conversation.create({ data: { userA: lo, userB: hi } });
    await tx.message.create({
      data: {
        conversationId: conv.id,
        senderId: userA,
        bodyEnc: Buffer.from(await crypto.encrypt(body)),
        moderationStatus: 'clean',
      },
    });
    return conv.id;
  });
}

beforeAll(async () => {
  t = await bootTestApp();
  admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
  await seedTaxonomy(admin);
});

afterAll(async () => {
  await admin.$disconnect();
  await t.app.close();
});

describe('data export (access right)', () => {
  it('anonymous 401; export returns the full own dataset with decrypted messages', async () => {
    const me = await mkUser();
    const other = await mkUser();
    const convId = await seedConversation(me.userId, other.userId, 'planning our first meet');
    await admin.photo.create({
      data: {
        userId: me.userId,
        storageKey: `exp-${me.userId}`,
        contentType: 'image/jpeg',
        moderationStatus: 'approved',
      },
    });

    const anon = await new TestClient(t.baseUrl).post('/v1/me/export', {});
    expect(anon.status).toBe(401);

    const res = await me.client.post('/v1/me/export', {}, me.client.csrfHeaders());
    expect(res.status).toBe(200);
    const data = res.json as unknown as {
      user: { id: string };
      profile: { userId: string };
      photos: { storageKey: string }[];
      conversations: { id: string; messages: { body: string }[] }[];
    };
    expect(data.user.id).toBe(me.userId);
    expect(data.profile.userId).toBe(me.userId);
    expect(data.photos.some((p) => p.storageKey === `exp-${me.userId}`)).toBe(true);
    const conv = data.conversations.find((c) => c.id === convId);
    expect(conv?.messages[0]?.body).toBe('planning our first meet');

    // The request is recorded and completed.
    const dsr = await admin.dsrRequest.findFirst({
      where: { userId: me.userId, type: 'access' },
    });
    expect(dsr?.status).toBe('completed');
  });
});

describe('erasure (delete account)', () => {
  it('deactivates immediately (sessions revoked, profile hidden), idempotent', async () => {
    const me = await mkUser();
    const first = await me.client.delete('/v1/me', me.client.csrfHeaders());
    expect(first.status).toBe(200);
    expect((first.json as { dsr: { type: string; status: string } }).dsr.type).toBe('erase');

    const again = await me.client.delete('/v1/me', me.client.csrfHeaders());
    expect(again.status).toBe(200);
    expect((again.json as { dsr: { id: string } }).dsr.id).toBe(
      (first.json as { dsr: { id: string } }).dsr.id,
    );

    const user = await admin.user.findUnique({ where: { id: me.userId } });
    expect(user?.status).toBe('deleting');
    const sessions = await admin.session.findMany({ where: { userId: me.userId } });
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
    const profile = await admin.profile.findUnique({ where: { userId: me.userId } });
    expect(profile?.visibility).toBe('hidden');
  });

  it('retention sweep hard-deletes users without billing records', async () => {
    const me = await mkUser();
    await seedConversation(me.userId, (await mkUser()).userId, 'see you soon');
    const dsr = await admin.dsrRequest.create({
      data: {
        userId: me.userId,
        type: 'erase',
        status: 'open',
        dueAt: new Date(Date.now() - 31 * 86_400_000),
        createdAt: new Date(Date.now() - 31 * 86_400_000),
      },
    });

    const svc = t.app.get(PrivacyService);
    const result = await svc.applyRetention(new Date());
    expect(result.erased).toBeGreaterThanOrEqual(1);

    const gone = await admin.user.findUnique({ where: { id: me.userId } });
    expect(gone).toBeNull();
    // The erase row cascades away with the user (completed moments earlier in
    // the same tx; the erasure itself is logged server-side).
    const done = await admin.dsrRequest.findUnique({ where: { id: dsr.id } });
    expect(done).toBeNull();
  });

  it('retention sweep anonymises users with billing records (8-year retention)', async () => {
    const me = await mkUser();
    await seedConversation(me.userId, (await mkUser()).userId, 'invoice kept, identity not');
    await admin.invoice.create({
      data: {
        userId: me.userId,
        invoiceNo: `INV-TEST-${me.userId.slice(0, 8)}`,
        lineItem: 'plus_monthly',
        amountPaise: 59000,
        gstPaise: 9000,
      },
    });
    await admin.dsrRequest.create({
      data: {
        userId: me.userId,
        type: 'erase',
        status: 'open',
        dueAt: new Date(Date.now() - 31 * 86_400_000),
        createdAt: new Date(Date.now() - 31 * 86_400_000),
      },
    });

    const svc = t.app.get(PrivacyService);
    const result = await svc.applyRetention(new Date());
    expect(result.anonymised).toBeGreaterThanOrEqual(1);

    const user = await admin.user.findUnique({ where: { id: me.userId } });
    expect(user?.status).toBe('erased');
    expect(user?.phoneHash).toBe(`erased:${me.userId}`);
    expect(user?.phoneEnc).toBeNull();
    expect(user?.birthYear).toBeNull();
    // C4 content destroyed (scoped to this user — the shared test DB holds
    // other specs' messages), billing record retained.
    expect(
      await admin.message.count({
        where: { conversation: { OR: [{ userA: me.userId }, { userB: me.userId }] } },
      }),
    ).toBe(0);
    expect(await admin.conversation.count({ where: { userA: me.userId } })).toBe(0);
    expect(await admin.invoice.count({ where: { userId: me.userId } })).toBe(1);
  });
});

describe('grievance workflow (IT Intermediary Rules)', () => {
  it('files with the SLA clock (C4 at rest); own list is owner-scoped', async () => {
    const me = await mkUser();
    const res = await me.client.post(
      '/v1/me/grievances',
      { category: 'harassment', details: 'another user keeps messaging me after I blocked them' },
      me.client.csrfHeaders(),
    );
    expect(res.status).toBe(200);
    expect(res.json?.type).toBe('grievance');

    const row = await admin.dsrRequest.findFirst({
      where: { userId: me.userId, type: 'grievance' },
    });
    expect(row?.dueAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    const raw = Buffer.from(row!.detailsEnc!).toString('utf8');
    expect(raw.includes('another user keeps messaging')).toBe(false);

    const mine = await me.client.get('/v1/me/grievances');
    expect((mine.json as unknown as unknown[]).length).toBeGreaterThanOrEqual(1);
    const outsider = await mkUser();
    const theirs = await outsider.client.get('/v1/me/grievances');
    expect(theirs.json).toEqual([]);
  });

  it('officer queue requires staff; admin resolves with an audit row', async () => {
    const me = await mkUser();
    await me.client.post(
      '/v1/me/grievances',
      { category: 'billing', details: 'double charged' },
      me.client.csrfHeaders(),
    );

    const plain = await mkUser();
    const denied = await plain.client.get('/v1/admin/grievances');
    expect(denied.status).toBe(403);

    // Staff (admin role; role claims refresh on token rotation — mint a fresh
    // access token after the promotion).
    const officer = await signupTestUser(t, `+9122${String((seq += 1)).padStart(8, '0')}`);
    await admin.user.update({ where: { id: officer.userId }, data: { role: 'admin' } });
    const refreshed = await officer.client.post('/v1/auth/refresh', undefined, officer.client.csrfHeaders());
    expect(refreshed.status).toBe(200);
    const queue = await officer.client.get('/v1/admin/grievances');
    expect(queue.status).toBe(200);
    const items = queue.json as unknown as { id: string; slaBreached: boolean }[];
    expect(items.length).toBeGreaterThanOrEqual(1);

    const decide = await officer.client.post(
      `/v1/admin/grievances/${items[0]!.id}/decide`,
      { resolution: 'refunded the duplicate charge' },
      officer.client.csrfHeaders(),
    );
    expect(decide.status).toBe(200);
    expect(decide.json?.status).toBe('completed');

    const audit = await admin.adminAudit.findFirst({
      where: { action: 'admin.action.grievance_decide' },
    });
    expect(audit?.subjectId).toBe(items[0]!.id);
  });
});
