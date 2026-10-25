/**
 * Admin console API tests (P2-06) — exit criterion 3: every admin view audited.
 * - member without elevation → 403; role=admin → allowed
 * - JIT elevate/drop: time-boxed, audited, expiry enforced, CSRF-guarded
 * - every view/action writes an admin_audit row (asserted per endpoint)
 * - C4 masking: phone/email never decrypted for admin responses (T7)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { bootTestApp, signupTestUser, TestClient, type TestApp } from '../helpers/test-app';
import { PrismaService } from '../../src/prisma/prisma.service';

const KYC_SECRET = 'test-kyc-webhook-secret-0123456789';

let t: TestApp;
let prisma: PrismaService;

async function setRole(userId: string, role: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.service', 'admin', true)`;
    await tx.user.update({ where: { id: userId }, data: { role } });
  });
}

/** Role claims refresh on token rotation (access JWT is short-lived). */
async function refreshSession(c: TestClient) {
  const res = await c.post('/v1/auth/refresh', undefined, c.csrfHeaders());
  expect(res.status).toBe(200);
}

/** Drive a KYC result for a user over the signed webhook (consent + start + result). */
async function driveKyc(c: TestClient, eventId: string, fields: Record<string, unknown>) {
  await c.put('/v1/me/consents/kyc', { granted: true, channel: 'app' }, c.csrfHeaders());
  const started = await c.post('/v1/me/kyc', { type: 'id' }, c.csrfHeaders());
  expect(started.status).toBe(201);
  const providerRef = (started.json as { providerRef: string }).providerRef;
  const body = { event_id: eventId, provider_ref: providerRef, ...fields };
  const res = await new TestClient(t.baseUrl).post('/v1/hooks/kyc', body, {
    'x-hub-signature-256': `sha256=${createHmac('sha256', KYC_SECRET).update(JSON.stringify(body)).digest('hex')}`,
  });
  expect(res.status).toBe(200);
}

async function auditRows() {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.service', 'admin', true)`;
    return tx.adminAudit.findMany({ orderBy: { createdAt: 'asc' } });
  });
}

beforeAll(async () => {
  t = await bootTestApp();
  prisma = t.app.get(PrismaService);
});

afterAll(async () => {
  await t.app.close();
});

describe('admin access control', () => {
  it('member without elevation is denied (403), including JIT self-elevation', async () => {
    const { client } = await signupTestUser(t, '+919876500701');
    expect((await client.get('/v1/admin/users')).status).toBe(403);
    const elevate = await client.post(
      '/v1/admin/jit/elevate',
      { reason: 'let me in' },
      client.csrfHeaders(),
    );
    expect(elevate.status).toBe(403);
  });

  it('role=admin works without elevation; users list is masked + audited', async () => {
    const { client, userId } = await signupTestUser(t, '+919876500702');
    await setRole(userId, 'admin');
    await refreshSession(client);
    const res = await client.get('/v1/admin/users');
    expect(res.status).toBe(200);
    const rows = res.json as unknown as { phone: string; email: string; role: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.phone).toBe('••••••'); // C4 never decrypted for admin v1
      expect(r.email).toBe('••••••');
    }

    const audit = await auditRows();
    const view = audit.find((a) => a.action === 'admin.view.users');
    expect(view?.actorId).toBe(userId);
    expect(view?.subjectKind).toBe('user');
  });

  it('JIT elevation: elevate (CSRF-guarded) → access → drop → denied; every step audited', async () => {
    const { client, userId } = await signupTestUser(t, '+919876500703');
    await setRole(userId, 'moderator');
    await refreshSession(client);

    // CSRF required on elevate.
    const noCsrf = await client.req('POST', '/v1/admin/jit/elevate', { reason: 'case review' });
    expect(noCsrf.status).toBe(403);

    const elevated = await client.post(
      '/v1/admin/jit/elevate',
      { reason: 'case review' },
      client.csrfHeaders(),
    );
    expect(elevated.status).toBe(200);

    // Elevated access works (via JIT).
    expect((await client.get('/v1/admin/users')).status).toBe(200);

    // Idempotent re-elevation returns the same active grant.
    const again = await client.post(
      '/v1/admin/jit/elevate',
      { reason: 'case review' },
      client.csrfHeaders(),
    );
    expect((again.json as { elevationId: string }).elevationId).toEqual(
      (elevated.json as { elevationId: string }).elevationId,
    );

    // Expiry is enforced: rewind the grant, access is denied again.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'admin', true)`;
      await tx.adminElevation.updateMany({
        where: { userId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
    });
    expect((await client.get('/v1/admin/users')).status).toBe(403);

    // Fresh elevation + explicit drop.
    await client.post('/v1/admin/jit/elevate', { reason: 'second shift' }, client.csrfHeaders());
    const dropped = await client.post('/v1/admin/jit/drop', undefined, client.csrfHeaders());
    expect(dropped.status).toBe(200);
    expect((await client.get('/v1/admin/users')).status).toBe(403);

    const audit = await auditRows();
    const actions = audit.filter((a) => a.actorId === userId).map((a) => a.action);
    expect(actions).toContain('admin.action.jit_elevate');
    expect(actions).toContain('admin.action.jit_drop');
    expect(actions).toContain('admin.view.users');
  });
});

describe('case queue + decisions (audited)', () => {
  it('full flow: case queue → user detail → decide → audit trail rows', async () => {
    // Subject with an open risk case: failed KYC (+30) + 2 open reports
    // (+50 capped) = 80 ≥ threshold 60.
    const { client: subjectClient, userId: subject } = await signupTestUser(t, '+919876500704');
    await driveKyc(subjectClient, 'evt.admin-kyc-fail', {
      result: 'fail',
      failure_reason: 'document unreadable',
    });
    const { client: r1 } = await signupTestUser(t, '+919876500705');
    const { client: r2 } = await signupTestUser(t, '+919876500706');
    await r1.post(`/v1/users/${subject}/report`, { reason: 'scam' }, r1.csrfHeaders());
    await r2.post(`/v1/users/${subject}/report`, { reason: 'fake_profile' }, r2.csrfHeaders());

    const { client: admin, userId: adminId } = await signupTestUser(t, '+919876500707');
    await setRole(adminId, 'admin');
    await refreshSession(admin);

    // Admin views are each audited.
    const before = (await auditRows()).length;
    const cases = await admin.get('/v1/admin/cases?status=open');
    expect(cases.status).toBe(200);
    const caseList = cases.json as unknown as { id: string; subjectId: string }[];
    const target = caseList.find((c) => c.subjectId === subject);
    expect(target).toBeDefined();

    const detail = await admin.get(`/v1/admin/users/${subject}`);
    expect(detail.status).toBe(200);
    expect((detail.json as { phone: string }).phone).toBe('••••••');
    expect((detail.json as { openReports: number }).openReports).toBe(2);

    const decided = await admin.post(
      `/v1/admin/cases/${target?.id}/decide`,
      { status: 'resolved', decision: 'Reviewed: reports not substantiated' },
      admin.csrfHeaders(),
    );
    expect(decided.status).toBe(200);

    const audit = await auditRows();
    const newRows = audit.slice(before);
    const actions = newRows.map((a) => a.action);
    expect(actions).toContain('admin.view.cases');
    expect(actions).toContain('admin.view.user');
    expect(actions).toContain('admin.action.case_decide');
    // The decide row names the exact case subject.
    const decideRow = newRows.find((a) => a.action === 'admin.action.case_decide');
    expect(decideRow?.subjectId).toBe(target?.id);

    // Decided cases drop out of the open queue.
    const after = await admin.get('/v1/admin/cases?status=open');
    expect((after.json as unknown as { id: string }[]).some((c) => c.id === target?.id)).toBe(
      false,
    );

    // Re-deciding a closed case is rejected.
    const again = await admin.post(
      `/v1/admin/cases/${target?.id}/decide`,
      { status: 'dismissed', decision: 'changed my mind' },
      admin.csrfHeaders(),
    );
    expect(again.status).toBe(400);

    // Audit browser itself is audited.
    const log = await admin.get('/v1/admin/audit');
    expect(log.status).toBe(200);
    expect((await auditRows()).some((a) => a.action === 'admin.view.audit')).toBe(true);
  });
});
