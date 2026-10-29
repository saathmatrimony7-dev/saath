/**
 * P4-05 notifications: owner feed + read marking, per-user settings, and
 * quiet-hours / daily-cap / channel suppression (DESIGN.md Â§14). The
 * suppression rules are asserted at the service boundary so the tests are
 * deterministic (no wall-clock dependence).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootTestApp, signupTestUser, TestClient, type TestApp } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';

let t: TestApp;
let admin: RlsPrismaClient;
let seq = 6100;

async function mkUser() {
  seq += 1;
  const { client, userId } = await signupTestUser(t, `+9144${String(seq).padStart(8, '0')}`);
  return { client, userId };
}

/** Minutes-from-midnight IST right now (mirrors the service's clock). */
function istMinutesNow(): number {
  const istMs = Date.now() + 5.5 * 3_600_000;
  const d = new Date(istMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** A quiet window covering `minutes` (2 min margin, wrap-safe). */
function quietCovering(minutes: number): { quietStartMin: number; quietEndMin: number } {
  return {
    quietStartMin: (minutes - 2 + 1440) % 1440,
    quietEndMin: (minutes + 3) % 1440,
  };
}

beforeAll(async () => {
  t = await bootTestApp();
  admin = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().adminUrl } } });
});

afterAll(async () => {
  await admin.$disconnect();
  await t.app.close();
});

describe('notification feed', () => {
  it('anonymous 401; owner sees own rows only; read marking works', async () => {
    const me = await mkUser();
    const other = await mkUser();
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'notifications', true)`;
      await tx.notification.create({
        data: { userId: me.userId, type: 'match.mutual', payload: { conversationId: 'x' } },
      });
      await tx.notification.create({
        data: { userId: other.userId, type: 'match.mutual', payload: {} },
      });
    });

    const anon = await new TestClient(t.baseUrl).get('/v1/notifications');
    expect(anon.status).toBe(401);

    const mine = await me.client.get('/v1/notifications');
    expect(mine.status).toBe(200);
    const rows = mine.json as unknown as { id: string; type: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('match.mutual');

    const read = await me.client.post(
      `/v1/notifications/${rows[0]!.id}/read`,
      {},
      me.client.csrfHeaders(),
    );
    expect(read.status).toBe(200);
    const after = (await me.client.get('/v1/notifications')).json as unknown as { readAt: string | null }[];
    expect(after[0]?.readAt).toBeTruthy();

    // Marking someone else's notification is a silent no-op (RLS).
    const third = await mkUser();
    const foreign = await third.client.post(
      `/v1/notifications/${rows[0]!.id}/read`,
      {},
      third.client.csrfHeaders(),
    );
    expect(foreign.status).toBe(200);
  });
});

describe('suppression rules (Â§14)', () => {
  it('quiet hours drop the notification', async () => {
    const { userId } = await mkUser();
    const svc = t.app.get(NotificationsService);
    const quiet = quietCovering(istMinutesNow());
    await svc.putSettings(userId, {
      ...quiet,
      dailyCap: 5,
      channels: { inapp: true, whatsapp: false },
    });
    const res = await svc.notify(userId, 'match.mutual', {});
    expect(res.delivered).toBe(false);
    expect(res.reason).toBe('quiet_hours');
  });

  it('daily cap drops beyond the limit', async () => {
    const { userId } = await mkUser();
    const svc = t.app.get(NotificationsService);
    // Quiet window that never triggers (start == end is "no quiet hours").
    await svc.putSettings(userId, {
      quietStartMin: 0,
      quietEndMin: 0,
      dailyCap: 2,
      channels: { inapp: true, whatsapp: false },
    });
    expect((await svc.notify(userId, 'match.mutual', {})).delivered).toBe(true);
    expect((await svc.notify(userId, 'match.mutual', {})).delivered).toBe(true);
    const third = await svc.notify(userId, 'match.mutual', {});
    expect(third.delivered).toBe(false);
    expect(third.reason).toBe('daily_cap');
  });

  it('channel off drops delivery', async () => {
    const { userId } = await mkUser();
    const svc = t.app.get(NotificationsService);
    await svc.putSettings(userId, {
      quietStartMin: 0,
      quietEndMin: 0,
      dailyCap: 5,
      channels: { inapp: false, whatsapp: false },
    });
    const res = await svc.notify(userId, 'match.mutual', {});
    expect(res.delivered).toBe(false);
    expect(res.reason).toBe('channel_off');
  });

  it('defaults apply when no settings row exists', async () => {
    const { userId } = await mkUser();
    const svc = t.app.get(NotificationsService);
    const now = istMinutesNow();
    const inDefaultQuiet = now >= 1320 || now < 480;
    const res = await svc.notify(userId, 'match.mutual', {});
    expect(res.delivered).toBe(!inDefaultQuiet);
  });
});
