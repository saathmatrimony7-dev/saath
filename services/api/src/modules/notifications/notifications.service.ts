/**
 * Notifications (P4-05, DESIGN.md §14): quiet hours, frequency caps and
 * per-channel preferences. In-app channel only for now (WhatsApp template
 * delivery is channel work deferred with the P5 comms polish). Quiet hours
 * are interpreted in IST until per-user timezone capture lands.
 *
 * Policy: a suppressed notification (quiet hours / cap / channel off) is
 * DROPPED, never queued — matches feed the in-app surfaces directly.
 */
import { Inject, Injectable } from '@nestjs/common';
import { createLogger } from '@saath/logger';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { RlsTransaction } from '../../prisma/rls-prisma.client';
import type { AppConfig } from '../../config';
import { APP_CONFIG } from '../identity/tokens';

const logger = createLogger('notifications');

export const NOTIFICATION_TYPES = [
  'match.mutual',
  'message.received',
  'subscription.activated',
  'intro_pack.credited',
  'coordinator.suggestion',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const IST_OFFSET_MS = 5.5 * 3_600_000;

/** Minutes-from-midnight in IST for `now`. */
function istMinutesNow(nowMs: number): number {
  const ist = new Date(nowMs + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/** UTC instant of the current IST calendar day's start. */
function istDayStartUtc(nowMs: number): Date {
  const istMs = nowMs + IST_OFFSET_MS;
  return new Date(istMs - (istMs % 86_400_000) - IST_OFFSET_MS);
}

interface NotificationSettingsRow {
  quietStartMin: number;
  quietEndMin: number;
  dailyCap: number;
  channels: Prisma.JsonValue;
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private defaults(): NotificationSettingsRow {
    return {
      quietStartMin: this.config.NOTIF_QUIET_START_MIN,
      quietEndMin: this.config.NOTIF_QUIET_END_MIN,
      dailyCap: this.config.NOTIF_DAILY_CAP,
      channels: { inapp: true, whatsapp: false },
    };
  }

  /**
   * Emits one notification in its own transaction. When the caller already
   * holds a transaction (messaging/billing pipelines), pass it via
   * `notifyInTx` — Prisma forbids nested `$transaction` on one client, and
   * the insert should be atomic with the caller's write anyway (the caller's
   * service context satisfies the notifications RLS service policy).
   */
  async notify(
    userId: string,
    type: NotificationType,
    payload: Record<string, unknown> = {},
  ): Promise<{ delivered: boolean; reason?: 'quiet_hours' | 'daily_cap' | 'channel_off' }> {
    const nowMs = Date.now();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'notifications', true)`;
      return this.notifyInTx(tx as RlsTransaction, userId, type, payload, nowMs);
    });
  }

  /** In-tx variant (see `notify`). */
  async notifyInTx(
    tx: RlsTransaction,
    userId: string,
    type: NotificationType,
    payload: Record<string, unknown> = {},
    nowMs = Date.now(),
  ): Promise<{ delivered: boolean; reason?: 'quiet_hours' | 'daily_cap' | 'channel_off' }> {
    const row = await tx.notificationSetting.findUnique({ where: { userId } });
      const settings: NotificationSettingsRow = row
        ? {
            quietStartMin: row.quietStartMin,
            quietEndMin: row.quietEndMin,
            dailyCap: row.dailyCap,
            channels: row.channels,
          }
        : this.defaults();
      const channels = (settings.channels ?? {}) as { inapp?: boolean };
      if (channels.inapp === false) return { delivered: false, reason: 'channel_off' };

      const minutes = istMinutesNow(nowMs);
      const { quietStartMin: s, quietEndMin: e } = settings;
      const inQuiet = s === e ? false : s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
      if (inQuiet) return { delivered: false, reason: 'quiet_hours' };

      const todayCount = await tx.notification.count({
        where: { userId, createdAt: { gte: istDayStartUtc(nowMs) } },
      });
      if (todayCount >= settings.dailyCap) return { delivered: false, reason: 'daily_cap' };

    await tx.notification.create({
      data: { userId, type, payload: payload as Prisma.InputJsonValue },
    });
    return { delivered: true };
  }

  /** Owner feed, newest first, cursor-paginated on (createdAt, id). */
  async list(userId: string, before?: { createdAt: Date; id: string }, limit = 50) {
    return this.prisma.withUser(userId, async (tx) => {
      const rows = await tx.notification.findMany({
        where: before
          ? {
              OR: [
                { createdAt: { lt: before.createdAt } },
                { createdAt: before.createdAt, id: { lt: before.id } },
              ],
            }
          : {},
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: Math.min(limit, 100),
      });
      return rows.map((r) => ({
        id: r.id,
        type: r.type,
        payload: r.payload,
        channel: r.channel,
        readAt: r.readAt,
        createdAt: r.createdAt,
      }));
    });
  }

  /** Marks one notification read (owner row only; 404 on anything else). */
  async markRead(userId: string, notificationId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      const res = await tx.notification.updateMany({
        where: { id: notificationId, userId, readAt: null },
        data: { readAt: new Date() },
      });
      if (res.count === 0) {
        logger.warn({ userId, notificationId }, 'notification read mark missed');
      }
    });
  }

  async getSettings(userId: string) {
    return this.prisma.withUser(userId, async (tx) => {
      const row = await tx.notificationSetting.findUnique({ where: { userId } });
      const d = this.defaults();
      return {
        quietStartMin: row?.quietStartMin ?? d.quietStartMin,
        quietEndMin: row?.quietEndMin ?? d.quietEndMin,
        dailyCap: row?.dailyCap ?? d.dailyCap,
        channels: row?.channels ?? d.channels,
      };
    });
  }

  async putSettings(
    userId: string,
    dto: { quietStartMin: number; quietEndMin: number; dailyCap: number; channels: unknown },
  ) {
    return this.prisma.withUser(userId, async (tx) => {
      const row = await tx.notificationSetting.upsert({
        where: { userId },
        create: {
          userId,
          quietStartMin: dto.quietStartMin,
          quietEndMin: dto.quietEndMin,
          dailyCap: dto.dailyCap,
          channels: dto.channels as Prisma.InputJsonValue,
        },
        update: {
          quietStartMin: dto.quietStartMin,
          quietEndMin: dto.quietEndMin,
          dailyCap: dto.dailyCap,
          channels: dto.channels as Prisma.InputJsonValue,
        },
      });
      return {
        quietStartMin: row.quietStartMin,
        quietEndMin: row.quietEndMin,
        dailyCap: row.dailyCap,
        channels: row.channels,
      };
    });
  }
}
