/**
 * Privacy / DPDP flows (P5-01, DESIGN.md §10.2 + §2.2): data-principal
 * rights (access/export, erasure, grievance) with the statutory clocks,
 * plus the retention sweep that finishes erasure.
 *
 * - Access: synchronous JSON export of everything the user owns (profile,
 *   preferences, consents, photos, conversations incl. decrypted message
 *   bodies, interactions, billing). Served over the authenticated session;
 *   a dsr_requests row records the request (completed).
 * - Erasure: DELETE /v1/me deactivates immediately (sessions revoked,
 *   profile hidden, no pool/match visibility); the sweeper finishes the job
 *   after PRIVACY_ERASE_RETENTION_DAYS — hard delete, EXCEPT users with
 *   billing records (law: 8-year retention) who are anonymised instead
 *   (identity columns nulled, C4 content destroyed, billing rows kept).
 * - Grievance: C4-encrypted details, due_at = GRIEVANCE_SLA_DAYS; the
 *   officer queue lives in the admin surface (staff roles).
 *
 * All data access runs in the 'privacy' service context (RLS); dsr rows are
 * also owner-readable/insertable for the self-serve surface.
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createLogger } from '@saath/logger';
import { FieldCrypto } from '@saath/crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { RlsTransaction } from '../../prisma/rls-prisma.client';
import type { AppConfig } from '../../config';
import { APP_CONFIG } from '../identity/tokens';

const logger = createLogger('privacy');

export type DsrType = 'access' | 'erase' | 'grievance';

export interface DsrView {
  id: string;
  type: DsrType;
  status: string;
  dueAt: Date;
  completedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class PrivacyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FieldCrypto) private readonly crypto: FieldCrypto,
  ) {}

  private async inService<T>(fn: (tx: RlsTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'privacy', true)`;
      return fn(tx as RlsTransaction);
    });
  }

  /** Sessions are scoped to the identity service (narrow, by design). */
  private async inIdentity<T>(fn: (tx: RlsTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'identity', true)`;
      return fn(tx as RlsTransaction);
    });
  }

  private dsrView(r: {
    id: string;
    type: string;
    status: string;
    dueAt: Date;
    completedAt: Date | null;
    createdAt: Date;
  }): DsrView {
    return {
      id: r.id,
      type: r.type as DsrType,
      status: r.status,
      dueAt: r.dueAt,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
    };
  }

  // ---- Access (export) -------------------------------------------------------

  /** Synchronous data export; records one completed 'access' request. */
  async exportUserData(userId: string) {
    return this.inService(async (tx) => {
      const existing = await this.findLatestOpen(tx, userId, 'access');
      if (existing) {
        // Re-requesting is fine: honour it, but only one open row exists.
        await tx.dsrRequest.update({
          where: { id: existing.id },
          data: { status: 'completed', completedAt: new Date() },
        });
      } else {
        const dsr = await this.recordDsr(tx, userId, 'access');
        await tx.dsrRequest.update({
          where: { id: dsr.id },
          data: { status: 'completed', completedAt: new Date() },
        });
      }

      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('user not found');
      const [profile, preference, consents, photos, interactions, subscriptions, invoices, entitlement] =
        await Promise.all([
          tx.profile.findUnique({ where: { userId } }),
          tx.preference.findUnique({ where: { userId } }),
          tx.consent.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
          tx.photo.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
          tx.interaction.findMany({
            where: { actorUserId: userId },
            orderBy: { createdAt: 'asc' },
          }),
          tx.subscription.findMany({ where: { userId } }),
          tx.invoice.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
          tx.entitlement.findUnique({ where: { userId } }),
        ]);

      // Conversations the user participates in, messages decrypted (a
      // participant is entitled to their conversation record, §10.2).
      const conversations = await tx.conversation.findMany({
        where: { OR: [{ userA: userId }, { userB: userId }] },
        orderBy: { openedAt: 'asc' },
      });
      const messagesByConv = new Map<string, unknown[]>();
      for (const c of conversations) {
        const rows = await tx.message.findMany({
          where: { conversationId: c.id },
          orderBy: { createdAt: 'asc' },
        });
        messagesByConv.set(
          c.id,
          await Promise.all(
            rows.map(async (m) => ({
              id: m.id,
              senderId: m.senderId,
              body: await this.crypto.decrypt(Buffer.from(m.bodyEnc)),
              moderationStatus: m.moderationStatus,
              createdAt: m.createdAt,
            })),
          ),
        );
      }

      const exportPayload = {
        generatedAt: new Date().toISOString(),
        noticeVersion: this.config.CONSENT_NOTICE_VERSION,
        user: {
          id: user.id,
          locale: user.locale,
          status: user.status,
          ageVerified: user.ageVerified,
          birthYear: user.birthYear,
          gender: user.gender,
          createdAt: user.createdAt,
        },
        profile,
        preferences: preference,
        consents,
        photos: photos.map((p) => ({
          id: p.id,
          storageKey: p.storageKey,
          contentType: p.contentType,
          moderationStatus: p.moderationStatus,
          isPrimary: p.isPrimary,
          createdAt: p.createdAt,
        })),
        interactions: interactions.map((i) => ({
          type: i.type,
          targetUserId: i.targetUserId,
          createdAt: i.createdAt,
        })),
        conversations: conversations.map((c) => ({
          id: c.id,
          origin: c.origin,
          openedAt: c.openedAt,
          messages: messagesByConv.get(c.id) ?? [],
        })),
        billing: { subscriptions, invoices, entitlements: entitlement },
      };
      logger.info({ userId }, 'data export served');
      return exportPayload;
    });
  }

  // ---- Erasure ---------------------------------------------------------------

  /**
   * Starts erasure: one 'erase' dsr row (idempotent), immediate
   * deactivation. The sweeper (scripts/privacy-sweeper.mjs, same service)
   * finishes after the retention window.
   */
  async requestErasure(userId: string): Promise<DsrView> {
    return this.inService(async (tx) => {
      const existing = await this.findLatestOpen(tx, userId, 'erase');
      if (existing) return this.dsrView(existing);
      const dsr = await this.recordDsr(tx, userId, 'erase');
      await tx.user.update({ where: { id: userId }, data: { status: 'deleting' } });
      await tx.profile.updateMany({ where: { userId }, data: { visibility: 'hidden' } });
      // Session revocation runs in the identity context (separate, narrow
      // policy); ordered after the deactivation write above.
      await this.inIdentity(async (itx) => {
        await itx.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      });
      logger.info({ userId, dsrId: dsr.id }, 'erasure requested; account deactivated');
      return this.dsrView(dsr);
    });
  }

  /**
   * Retention sweep (§10.2): erase requests past the retention window are
   * finished. Users WITH billing records are anonymised (8-year retention
   * of billing data; identity nulled, C4 content destroyed); everyone else
   * is hard-deleted (cascade). Returns counts for evidence.
   */
  async applyRetention(now = new Date()): Promise<{ erased: number; anonymised: number }> {
    const cutoff = new Date(
      now.getTime() - this.config.PRIVACY_ERASE_RETENTION_DAYS * 86_400_000,
    );
    return this.inService(async (tx) => {
      const due = await tx.dsrRequest.findMany({
        where: { type: 'erase', status: 'open', createdAt: { lte: cutoff } },
      });
      let erased = 0;
      let anonymised = 0;
      for (const dsr of due) {
        const userId = dsr.userId;
        const hasBilling =
          (await tx.payment.count({ where: { userId } })) > 0 ||
          (await tx.invoice.count({ where: { userId } })) > 0;
        // Complete the dsr row FIRST: hard-delete cascades it away (the
        // erasure log lives in the server logs; the user is gone).
        await tx.dsrRequest.update({
          where: { id: dsr.id },
          data: { status: 'completed', completedAt: now },
        });
        if (hasBilling) {
          await this.anonymise(tx, userId);
          anonymised += 1;
        } else {
          await tx.user.delete({ where: { id: userId } });
          erased += 1;
        }
        logger.info({ userId, anonymised: hasBilling }, 'erasure completed');
      }
      return { erased, anonymised };
    });
  }

  /** Billing-retention anonymisation: identity nulled, C4 content destroyed. */
  private async anonymise(tx: RlsTransaction, userId: string): Promise<void> {
    await tx.message.deleteMany({
      where: { conversation: { OR: [{ userA: userId }, { userB: userId }] } },
    });
    await tx.conversation.deleteMany({ where: { OR: [{ userA: userId }, { userB: userId }] } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.dailyMatch.deleteMany({
      where: { OR: [{ userId }, { candidateId: userId }] },
    });
    // The pgvector embedding is Unsupported for Prisma — clear it in raw SQL.
    await tx.$executeRaw`UPDATE "profiles" SET "embedding" = NULL WHERE "user_id" = ${userId}::uuid`;
    await tx.user.update({
      where: { id: userId },
      data: {
        phoneHash: `erased:${userId}`,
        phoneEnc: null,
        emailEnc: null,
        status: 'erased',
        birthYear: null,
        gender: null,
        lastActiveAt: null,
      },
    });
    await tx.profile.updateMany({
      where: { userId },
      data: {
        displayName: null,
        aboutNormalised: null,
        embeddingSummaryHash: null,
        embeddingUpdatedAt: null,
        visibility: 'hidden',
      },
    });
  }

  // ---- Grievance -------------------------------------------------------------

  /** Opens a grievance (C4 details) with the statutory SLA clock. */
  async fileGrievance(userId: string, category: string, details: string): Promise<DsrView> {
    return this.inService(async (tx) => {
      const dsr = await this.recordDsr(tx, userId, 'grievance');
      await tx.dsrRequest.update({
        where: { id: dsr.id },
        data: {
          detailsEnc: Buffer.from(
            await this.crypto.encrypt(JSON.stringify({ category, details })),
          ),
        },
      });
      logger.info({ userId, dsrId: dsr.id }, 'grievance filed');
      return this.dsrView(dsr);
    });
  }

  /** Own requests (any type) — owner RLS context. */
  async listMine(userId: string): Promise<DsrView[]> {
    return this.prisma.withUser(userId, async (tx) => {
      const rows = await tx.dsrRequest.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return rows.map((r) => this.dsrView(r));
    });
  }

  // ---- Grievance-officer queue (staff surface) --------------------------------

  /** Open grievances by SLA (service context; the controller enforces staff). */
  async grievanceQueue() {
    return this.inService(async (tx) => {
      const rows = await tx.dsrRequest.findMany({
        where: { type: 'grievance', status: 'open' },
        orderBy: { dueAt: 'asc' },
        take: 100,
      });
      return rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        status: r.status,
        dueAt: r.dueAt,
        slaBreached: r.dueAt < new Date(),
        createdAt: r.createdAt,
      }));
    });
  }

  async resolveGrievance(id: string, resolution: string, decidedBy: string) {
    return this.inService(async (tx) => {
      const row = await tx.dsrRequest.findUnique({ where: { id } });
      if (!row || row.type !== 'grievance') throw new NotFoundException('grievance not found');
      const updated = await tx.dsrRequest.update({
        where: { id },
        data: {
          status: 'completed',
          resolution: `${decidedBy}: ${resolution}`.slice(0, 500),
          completedAt: new Date(),
        },
      });
      logger.info({ id, decidedBy }, 'grievance resolved');
      return this.dsrView(updated);
    });
  }

  // ---- Internals --------------------------------------------------------------

  private async recordDsr(tx: RlsTransaction, userId: string, type: DsrType) {
    const slaDays =
      type === 'grievance'
        ? this.config.GRIEVANCE_SLA_DAYS
        : this.config.PRIVACY_ERASE_RETENTION_DAYS;
    return tx.dsrRequest.create({
      data: {
        userId,
        type,
        status: 'open',
        dueAt: new Date(Date.now() + slaDays * 86_400_000),
      },
    });
  }

  private async findLatestOpen(tx: RlsTransaction, userId: string, type: DsrType) {
    return tx.dsrRequest.findFirst({
      where: { userId, type, status: 'open' },
      orderBy: { createdAt: 'desc' },
    });
  }
}
