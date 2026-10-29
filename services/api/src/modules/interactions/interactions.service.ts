/**
 * Interactions (P3-08, DESIGN.md §9): likes / passes / shortlists on daily
 * feed candidates. One row per (actor, target, type); like⇄pass are exclusive
 * dispositions — posting one flips (deletes) the other, so a pass→like
 * un-suppresses the candidate for future batches. All writes run in the
 * 'interactions' service context (RLS, owner-read table). Entitlement caps
 * are server-side config until the entitlements table lands with billing
 * (P4, Q7 — same precedent as MATCHING_DAILY_PUBLISH_COUNT).
 *
 * Privacy: a target user never learns who liked/passed them (RLS owner-read
 * on actor only); reveal happens only via mutual match (P4) — the
 * conversation open is wired here (P4-03).
 */
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { createLogger } from '@saath/logger';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AppConfig } from '../../config';
import { APP_CONFIG } from '../identity/tokens';
import { MessagingService } from '../messaging/messaging.service';

const logger = createLogger('interactions');

export const INTERACTION_TYPES = ['like', 'pass', 'shortlist'] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

/** Closed pass-reason vocabulary (mirrored by the migration CHECK + DTO). */
export const PASS_REASON_CODES = [
  'not_interested',
  'too_far',
  'profile_insufficient',
  'other',
] as const;
export type PassReasonCode = (typeof PASS_REASON_CODES)[number];

export interface RecordInteractionResult {
  type: InteractionType;
  /** false when the identical row already existed (idempotent no-op). */
  recorded: boolean;
  already: boolean;
  /** P4-03: true when this like completed a mutual pair (conversation opened). */
  mutual: boolean;
}

@Injectable()
export class InteractionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MessagingService) private readonly messaging: MessagingService,
  ) {}

  /**
   * Records a disposition. Idempotent per (actor, target, type); like/pass
   * replace each other. Caps are checked before the write (soft cap: two
   * concurrent first-likes for different targets could both pass — the
   * entitlement is advisory until P4 billing makes it authoritative).
   */
  async record(
    actorId: string,
    targetId: string,
    type: InteractionType,
    reasonCode?: PassReasonCode,
  ): Promise<RecordInteractionResult> {
    if (actorId === targetId) {
      throw new ForbiddenException('cannot interact with yourself');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'interactions', true)`;
      const existing = await tx.interaction.findUnique({
        where: {
          actorUserId_targetUserId_type: { actorUserId: actorId, targetUserId: targetId, type },
        },
      });
      // Idempotent no-op: an identical row never consumes entitlement budget.
      if (existing) {
        return { type, recorded: false, already: true };
      }
      if (type === 'like') await this.assertUnderDailyLikeLimit(tx, actorId);
      if (type === 'shortlist') await this.assertUnderShortlistLimit(tx, actorId);

      // Disposition flip: like and pass replace each other.
      const opposite = type === 'like' ? 'pass' : type === 'pass' ? 'like' : null;
      if (opposite) {
        await tx.interaction.deleteMany({
          where: { actorUserId: actorId, targetUserId: targetId, type: opposite },
        });
      }
      await tx.interaction.create({
        data: {
          actorUserId: actorId,
          targetUserId: targetId,
          type,
          reasonCode: type === 'pass' ? (reasonCode ?? null) : null,
        },
      });
      logger.info({ actorId, targetId, type }, 'interaction recorded');
      return { type, recorded: true, already: false };
    }).then(async (result) => {
      // P4-03: a like that completes a mutual pair opens the conversation
      // (match.mutual). Checked AFTER the disposition commits so the reveal
      // never precedes the record; openForMutual is idempotent.
      if (type === 'like' && result.recorded) {
        const mutual = await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.service', 'interactions', true)`;
          return tx.interaction.findUnique({
            where: {
              actorUserId_targetUserId_type: {
                actorUserId: targetId,
                targetUserId: actorId,
                type: 'like',
              },
            },
          });
        });
        if (mutual) {
          await this.messaging.openForMutual(actorId, targetId);
          return { ...result, mutual: true };
        }
      }
      return { ...result, mutual: false };
    });
  }

  /** UTC-day boundary, matching the batch's batch_date convention. */
  private startOfUtcDay(): Date {
    return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  }

  private async assertUnderDailyLikeLimit(
    tx: Prisma.TransactionClient,
    actorId: string,
  ): Promise<void> {
    const limit = this.config.MATCHING_LIKE_DAILY_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ForbiddenException('invalid daily like limit');
    }
    const used = await tx.interaction.count({
      where: { actorUserId: actorId, type: 'like', createdAt: { gte: this.startOfUtcDay() } },
    });
    if (used >= limit) {
      throw new ForbiddenException('daily like limit reached');
    }
  }

  private async assertUnderShortlistLimit(
    tx: Prisma.TransactionClient,
    actorId: string,
  ): Promise<void> {
    const limit = this.config.MATCHING_SHORTLIST_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ForbiddenException('invalid shortlist limit');
    }
    const used = await tx.interaction.count({
      where: { actorUserId: actorId, type: 'shortlist' },
    });
    if (used >= limit) {
      throw new ForbiddenException('shortlist limit reached');
    }
  }
}
