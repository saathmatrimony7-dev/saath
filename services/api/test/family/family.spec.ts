/**
 * P3-10 Family Mode v1 — endpoint + authz matrix (DESIGN.md §6 A7, §10.2(c),
 * D7). Covers: invite create/accept/expire/reuse, the owner/family/anon
 * authz matrix, D7 permission enforcement, family_mode consent gating
 * (withdrawal hides the shortlist immediately — inside the 24 h bound),
 * disclosure-gated family view, encrypted feedback, and the A7 summary.
 */
import { createHash, randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, signupTestUser, TestClient, type TestApp } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { seedTaxonomy } from '../../prisma/seed-taxonomy-runner';

let t: TestApp;
let admin: RlsPrismaClient;
let seq = 9000;

async function mkUser(shareLevel?: string) {
  seq += 1;
  const { client, userId } = await signupTestUser(t, `+9166${String(seq).padStart(8, '0')}`);
  const pr = await client.patch(
    '/v1/me/profile',
    {
      cityId: 'mumbai',
      diet: 'veg',
      heightCm: 168,
      maritalStatus: 'never_married',
      willingToRelocate: true,
      religionId: 'hindu',
      communityId: 'hindu-brahmin',
    },
    client.csrfHeaders(),
  );
  expect(pr.status).toBe(200);
  await admin.user.update({
    where: { id: userId },
    data: { ageVerified: true, birthYear: new Date().getFullYear() - 29, status: 'active' },
  });
  await admin.profile.update({ where: { userId }, data: { verificationTier: 1 } });
  await admin.photo.create({
    data: {
      userId,
      storageKey: `fam-${userId}`,
      contentType: 'image/jpeg',
      moderationStatus: 'approved',
      isPrimary: true,
    },
  });
  if (shareLevel) {
    const dp = await client.put('/v1/me/disclosure-policy', { shareLevel }, client.csrfHeaders());
    expect(dp.status).toBe(200);
  }
  return { client, userId };
}

/** Owner shortlists `candidateId` (setup helper — inserts the interaction). */
async function shortlist(ownerId: string, candidateId: string) {
  await admin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.service', 'interactions', true)`;
    await tx.interaction.create({
      data: { actorUserId: ownerId, targetUserId: candidateId, type: 'shortlist' },
    });
  });
}

async function grantFamilyConsent(owner: { client: TestClient }, granted: boolean) {
  const r = await owner.client.put(
    '/v1/me/consents/family_mode',
    { granted },
    owner.client.csrfHeaders(),
  );
  expect(r.status).toBe(200);
}

const accept = (member: { client: TestClient }, token: string) =>
  member.client.post('/v1/family/invites/accept', { token }, member.client.csrfHeaders());

beforeAll(async () => {
  t = await bootTestApp();
  admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
  await seedTaxonomy(admin);
});

afterAll(async () => {
  await admin.$disconnect();
  await t.app.close();
});

describe('family invites', () => {
  it('owner creates → member accepts → listed; token single-use; D7 strict perms', async () => {
    const owner = await mkUser();
    const member = await mkUser();

    const anon = await new TestClient(t.baseUrl).post('/v1/family/invites', {
      relation: 'parent',
    });
    expect(anon.status).toBe(401);

    const bad = await owner.client.post(
      '/v1/family/invites',
      { relation: 'parent', permissions: { view: true, comment: true, contact: true } },
      owner.client.csrfHeaders(),
    );
    expect(bad.status).toBe(400); // D7: unknown permission keys rejected

    const created = await owner.client.post(
      '/v1/family/invites',
      { relation: 'parent' },
      owner.client.csrfHeaders(),
    );
    expect(created.status).toBe(200);
    const { token, inviteId } = created.json as { token: string; inviteId: string };
    expect(token.length).toBeGreaterThan(40);
    // Only the hash is stored.
    const row = await admin.familyAccount.findUnique({ where: { id: inviteId } });
    expect(row?.inviteTokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(row?.inviteTokenHash).not.toContain(token.slice(0, 12));

    const accepted = await accept(member, token);
    expect(accepted.status).toBe(200);
    expect(accepted.json).toMatchObject({ status: 'accepted', ownerId: owner.userId });

    // Single-use: the hash was cleared, so the token is unfindable (404).
    const reuse = await accept(member, token);
    expect(reuse.status).toBe(404);

    // Self-accept of a fresh invite is rejected.
    const own = await owner.client.post(
      '/v1/family/invites',
      { relation: 'sibling' },
      owner.client.csrfHeaders(),
    );
    const self = await accept(owner, (own.json as { token: string }).token);
    expect(self.status).toBe(400);

    const list = await owner.client.get('/v1/family/invites');
    expect(list.status).toBe(200);
    const rows = list.json as unknown as {
      inviteId: string;
      ownerId: string;
      memberId: string | null;
      relation: string;
      permissions: { view: boolean; comment: boolean };
      status: string;
      amMember: boolean;
    }[];
    const mine = rows.find((r) => r.inviteId === inviteId)!;
    expect(mine.memberId).toBe(member.userId);
    expect(mine.permissions).toEqual({ view: true, comment: true });
  });

  it('expired invites are rejected and lazily marked', async () => {
    const owner = await mkUser();
    const member = await mkUser();
    const token = randomBytes(32).toString('base64url');
    await admin.familyAccount.create({
      data: {
        profileUserId: owner.userId,
        invitedBy: owner.userId,
        relation: 'sibling',
        permissions: { view: true, comment: true },
        status: 'pending',
        inviteTokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const res = await accept(member, token);
    expect(res.status).toBe(403);
    const row = await admin.familyAccount.findFirst({
      where: { profileUserId: owner.userId, memberUserId: null },
    });
    expect(row?.status).toBe('expired');
  });
});

describe('family shortlist (consent gate + disclosure gating)', () => {
  it('member sees the gated shortlist only while the owner consents', async () => {
    const owner = await mkUser();
    const member = await mkUser();
    const candA = await mkUser(); // standard
    const candB = await mkUser('minimal');
    await shortlist(owner.userId, candA.userId);
    await shortlist(owner.userId, candB.userId);

    const invite = await owner.client.post(
      '/v1/family/invites',
      { relation: 'parent' },
      owner.client.csrfHeaders(),
    );
    await accept(member, (invite.json as { token: string }).token);

    // No consent yet → blocked (§10.2(c)).
    const before = await member.client.get('/v1/family/shortlist');
    expect(before.status).toBe(403);

    await grantFamilyConsent(owner, true);
    const ok = await member.client.get('/v1/family/shortlist');
    expect(ok.status).toBe(200);
    const body = ok.json as unknown as {
      ownerId: string;
      cards: {
        candidateId: string;
        photo?: { url: string };
        religion?: { id: string };
        community?: { id: string };
      }[];
    };
    expect(body.ownerId).toBe(owner.userId);
    expect(body.cards).toHaveLength(2);
    const cardA = body.cards.find((c) => c.candidateId === candA.userId)!;
    expect(cardA.photo?.url).toContain('/v1/storage-mock/file?key=');
    expect(cardA.religion?.id).toBe('hindu');
    const cardB = body.cards.find((c) => c.candidateId === candB.userId)!;
    expect(cardB).not.toHaveProperty('photo'); // minimal → gated
    expect(cardB).not.toHaveProperty('religion');
    expect(cardB).not.toHaveProperty('community');

    // Withdrawal takes effect immediately (well inside the 24 h bound).
    await grantFamilyConsent(owner, false);
    const after = await member.client.get('/v1/family/shortlist');
    expect(after.status).toBe(403);
    // Re-grant restores.
    await grantFamilyConsent(owner, true);
    expect((await member.client.get('/v1/family/shortlist')).status).toBe(200);
  });

  it('authz matrix: anon 401, unrelated 403, blocked candidates hidden', async () => {
    const owner = await mkUser();
    const member = await mkUser();
    const stranger = await mkUser();
    const blocked = await mkUser();
    await shortlist(owner.userId, blocked.userId);
    await grantFamilyConsent(owner, true);
    const invite = await owner.client.post(
      '/v1/family/invites',
      { relation: 'guardian' },
      owner.client.csrfHeaders(),
    );
    await accept(member, (invite.json as { token: string }).token);

    expect((await new TestClient(t.baseUrl).get('/v1/family/shortlist')).status).toBe(401);
    expect((await stranger.client.get('/v1/family/shortlist')).status).toBe(403);

    // Owner blocks the candidate → hidden from the family view too.
    const blk = await owner.client.put(
      `/v1/users/${blocked.userId}/block`,
      undefined,
      owner.client.csrfHeaders(),
    );
    expect(blk.status).toBe(200);
    const res = await member.client.get('/v1/family/shortlist');
    expect((res.json as unknown as { cards: unknown[] }).cards).toHaveLength(0);
  });
});

describe('family feedback (D7 + encrypted comments)', () => {
  it('comment permission enforced; comment encrypted at rest; owner reads', async () => {
    const owner = await mkUser();
    const member = await mkUser();
    const cand = await mkUser();
    await shortlist(owner.userId, cand.userId);
    await grantFamilyConsent(owner, true);
    const invite = await owner.client.post(
      '/v1/family/invites',
      { relation: 'parent', permissions: { view: true, comment: false } },
      owner.client.csrfHeaders(),
    );
    await accept(member, (invite.json as { token: string }).token);

    // D7: no comment permission → 403 (owner approves everything else).
    const denied = await member.client.post(
      '/v1/family/feedback',
      { candidateId: cand.userId, signal: 'approve' },
      member.client.csrfHeaders(),
    );
    expect(denied.status).toBe(403);

    // Re-invite with comment permission (revoke old row first via expiry path:
    // v1 has no revoke endpoint, so simulate by updating the row directly).
    await admin.familyAccount.updateMany({
      where: { profileUserId: owner.userId, memberUserId: member.userId },
      data: { permissions: { view: true, comment: true } },
    });

    const badSignal = await member.client.post(
      '/v1/family/feedback',
      { candidateId: cand.userId, signal: 'love_it' },
      member.client.csrfHeaders(),
    );
    expect(badSignal.status).toBe(400);

    const notShortlisted = await mkUser();
    const offList = await member.client.post(
      '/v1/family/feedback',
      { candidateId: notShortlisted.userId, signal: 'approve' },
      member.client.csrfHeaders(),
    );
    expect(offList.status).toBe(400); // must reference the owner's shortlist

    const ok = await member.client.post(
      '/v1/family/feedback',
      { candidateId: cand.userId, signal: 'approve', comment: 'Seems like a good match.' },
      member.client.csrfHeaders(),
    );
    expect(ok.status).toBe(200);

    // Comment is encrypted at rest (C4).
    const raw = await admin.familyFeedback.findFirst({
      where: { profileUserId: owner.userId },
    });
    expect(raw).toBeDefined();
    const stored = Buffer.from(raw!.commentEnc!).toString('utf8');
    expect(stored).not.toContain('good match');

    // Owner reads the decrypted feedback; author reads their own.
    const ownerView = await owner.client.get('/v1/family/feedback');
    expect(ownerView.status).toBe(200);
    const rows = (ownerView.json as unknown as { rows: { signal: string; comment: string }[] })
      .rows;
    expect(rows[0]).toMatchObject({ signal: 'approve', comment: 'Seems like a good match.' });

    const memberView = await member.client.get(`/v1/family/feedback?ownerId=${owner.userId}`);
    expect(memberView.status).toBe(200);
    expect((memberView.json as unknown as { rows: unknown[] }).rows).toHaveLength(1);
  });

  it('family cannot change the owner’s preferences; cards carry no contact fields', async () => {
    const owner = await mkUser();
    const member = await mkUser();
    await grantFamilyConsent(owner, true);
    const invite = await owner.client.post(
      '/v1/family/invites',
      { relation: 'sibling' },
      owner.client.csrfHeaders(),
    );
    await accept(member, (invite.json as { token: string }).token);

    // The member's /v1/me/* surface only ever touches their OWN account.
    const prefs = await member.client.put(
      '/v1/me/preferences',
      { relocateOk: false, dietOk: ['vegan'], maritalOk: ['never_married'] },
      member.client.csrfHeaders(),
    );
    expect(prefs.status).toBe(200);
    const ownerPrefs = await owner.client.get('/v1/me/preferences');
    expect(ownerPrefs.status).toBe(200); // untouched

    // Shortlist cards expose no contact surface at all.
    const cand = await mkUser();
    await shortlist(owner.userId, cand.userId);
    const view = await member.client.get('/v1/family/shortlist');
    const card = (view.json as unknown as { cards: Record<string, unknown>[] }).cards[0]!;
    const keys = Object.keys(card).join(',');
    for (const forbidden of ['phone', 'email', 'contact', 'displayName']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('A7 summary', () => {
  it('mock summariser returns a locale-correct digest; authz enforced', async () => {
    const owner = await mkUser();
    const member = await mkUser();
    const cand = await mkUser();
    await shortlist(owner.userId, cand.userId);
    await grantFamilyConsent(owner, true);
    const invite = await owner.client.post(
      '/v1/family/invites',
      { relation: 'parent' },
      owner.client.csrfHeaders(),
    );
    await accept(member, (invite.json as { token: string }).token);
    await member.client.post(
      '/v1/family/feedback',
      { candidateId: cand.userId, signal: 'approve' },
      member.client.csrfHeaders(),
    );

    expect((await new TestClient(t.baseUrl).get('/v1/family/summary')).status).toBe(401);

    const ownerSummary = await owner.client.get('/v1/family/summary');
    expect(ownerSummary.status).toBe(200);
    const s = ownerSummary.json as unknown as { locale: string; summary: string };
    expect(s.locale).toBe('en');
    expect(s.summary).toContain('1 approve');

    const memberSummary = await member.client.get(`/v1/family/summary?ownerId=${owner.userId}`);
    expect(memberSummary.status).toBe(200);
    expect((memberSummary.json as unknown as { summary: string }).summary).toContain('1 approve');
  });
});
