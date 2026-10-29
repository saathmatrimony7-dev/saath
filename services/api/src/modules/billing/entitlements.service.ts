/**
 * Entitlements (P4-06, DESIGN.md §13): the SINGLE source of truth for
 * feature gating. Effective features = the user's plan row (free when no
 * active subscription) overlaid with the entitlements row (intro credits,
 * support grants, valid_until). The entitlements row is written ONLY from
 * verified webhook processing (P4-07) or server-side provider confirmation
 * — never from client claims. All reads run in the 'billing' service
 * context; all writes go through BillingService's webhook pipeline.
 */
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { createLogger } from '@saath/logger';
import { PrismaService } from '../../prisma/prisma.service';
import type { RlsTransaction } from '../../prisma/rls-prisma.client';

const logger = createLogger('entitlements');

export interface EffectiveEntitlements {
  planId: string;
  chat: boolean;
  calls: boolean;
  /** -1 means unlimited (paid plans). */
  dailyMessageLimit: number;
  introCredits: number;
  validUntil: Date | null;
}

@Injectable()
export class EntitlementsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async effective(userId: string): Promise<EffectiveEntitlements> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'billing', true)`;
      return this.effectiveInTx(tx as RlsTransaction, userId);
    });
  }

  /** In-tx variant so callers composing a larger tx pay one round-trip set. */
  async effectiveInTx(tx: RlsTransaction, userId: string): Promise<EffectiveEntitlements> {
    const now = new Date();
    const sub = await tx.subscription.findFirst({
      where: {
        userId,
        status: 'active',
        OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
    const plan = sub?.plan ?? (await tx.plan.findUniqueOrThrow({ where: { id: 'free' } }));
    const row = await tx.entitlement.findUnique({ where: { userId } });

    const base = (plan.features ?? {}) as Record<string, unknown>;
    const overlay = ((row?.features ?? {}) as Record<string, unknown>) ?? {};
    const merged: Record<string, unknown> = { ...base, ...overlay };
    const ends = [sub?.currentPeriodEnd ?? null, row?.validUntil ?? null].filter(
      (d): d is Date => d !== null,
    );
    return {
      planId: plan.id,
      chat: merged.chat !== false,
      calls: merged.calls === true,
      dailyMessageLimit:
        typeof merged.dailyMessageLimit === 'number' ? merged.dailyMessageLimit : 20,
      introCredits:
        (typeof base.introCredits === 'number' ? base.introCredits : 0) + (row?.introCredits ?? 0),
      validUntil: ends.length > 0 ? new Date(Math.min(...ends.map((d) => d.getTime()))) : null,
    };
  }

  /**
   * Consumes one intro credit inside the caller's transaction (P4-06:
   * opening a non-mutual conversation spends a credit). The entitlements
   * row is created on first use; a user without credits is rejected here —
   * the paywall is authoritative server-side.
   */
  async consumeIntroCreditInTx(tx: RlsTransaction, userId: string): Promise<void> {
    await tx.$executeRaw`SELECT set_config('app.service', 'billing', true)`;
    const row = await tx.entitlement.findUnique({ where: { userId } });
    const credits = row?.introCredits ?? 0;
    if (credits <= 0) {
      throw new ForbiddenException({
        message: 'intro pack required',
        code: 'PAYWALL',
      });
    }
    await tx.entitlement.upsert({
      where: { userId },
      create: { userId, introCredits: 0 },
      update: { introCredits: { decrement: 1 }, version: { increment: 1 } },
    });
    logger.info({ userId, remaining: credits - 1 }, 'intro credit consumed');
  }

  /** Adds intro-pack credits inside the caller's transaction (webhook path). */
  async addIntroCreditsInTx(tx: RlsTransaction, userId: string, credits: number): Promise<void> {
    await tx.entitlement.upsert({
      where: { userId },
      create: { userId, introCredits: credits, version: 1 },
      update: { introCredits: { increment: credits }, version: { increment: 1 } },
    });
  }
}
