/**
 * Family Mode service (P3-10, DESIGN.md §6 A7 + §10.2(c) + D7).
 *
 * - accounts_family: owner invites via a single-use sha256-hashed token;
 *   members bind their own (phone-OTP) account at accept time. All writes
 *   are service-context — RLS gives users SELECT only, so a family member
 *   can never escalate their own permissions (owner approval enforced).
 * - family_feedback: structured signals (+ C4-encrypted comment). Writes
 *   require the comment permission (D7) AND the owner's live family_mode
 *   consent (§10.2(c)); the consent check runs per request, so withdrawal
 *   takes effect immediately — well inside the 24 h bound.
 * - The shortlist view comes from MatchingService.getShortlistCards AFTER
 *   membership + consent authz (disclosure-gated there).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createLogger } from '@saath/logger';
import { FieldCrypto } from '@saath/crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AppConfig } from '../../config';
import { APP_CONFIG } from '../identity/tokens';
import { ConsentService } from '../consent/consent.service';
import { MatchingService } from '../matching/matching.service';
import { FAMILY_SUMMARISER } from './tokens';
import type { AcceptInviteDto, CreateInviteDto, FamilyFeedbackDto } from './family.dto';
import type { FamilySummariserClient } from './summariser';

const logger = createLogger('family');

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

type Permissions = { view?: unknown; comment?: unknown };

function perms(row: { permissions: unknown }): { view: boolean; comment: boolean } {
  const p = (row.permissions ?? {}) as Permissions;
  return { view: p.view === true, comment: p.comment === true };
}

@Injectable()
export class FamilyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ConsentService) private readonly consents: ConsentService,
    @Inject(MatchingService) private readonly matching: MatchingService,
    @Inject(FAMILY_SUMMARISER) private readonly summariser: FamilySummariserClient,
    @Inject(FieldCrypto) private readonly crypto: FieldCrypto,
  ) {}

  /** Every access runs in the 'family' service context (RLS service policy). */
  private async inService<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'family', true)`;
      return fn(tx);
    });
  }

  // ---- §10.2(c) consent -----------------------------------------------------

  /** The owner's live family_mode consent is required for any sharing. */
  private async assertFamilyConsent(ownerId: string): Promise<void> {
    const latest = await this.consents.latest(ownerId);
    const family = latest.find((c) => c.purpose === 'family_mode');
    if (!family?.granted) {
      throw new ForbiddenException('family_mode consent is required for family sharing');
    }
  }

  // ---- Invites ---------------------------------------------------------------

  async createInvite(
    ownerId: string,
    dto: CreateInviteDto,
  ): Promise<{ inviteId: string; token: string; expiresAt: string }> {
    const ttlDays = dto.ttlDays ?? this.config.FAMILY_INVITE_TTL_DAYS;
    const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
    const token = randomBytes(32).toString('base64url');
    const row = await this.inService((tx) =>
      tx.familyAccount.create({
        data: {
          profileUserId: ownerId,
          invitedBy: ownerId,
          relation: dto.relation,
          permissions: dto.permissions,
          status: 'pending',
          inviteTokenHash: hashToken(token),
          expiresAt,
        },
      }),
    );
    logger.info({ ownerId, inviteId: row.id, relation: dto.relation }, 'family invite created');
    // The plaintext token is returned exactly once — only its sha256 is stored.
    return { inviteId: row.id, token, expiresAt: expiresAt.toISOString() };
  }

  async acceptInvite(
    memberId: string,
    dto: AcceptInviteDto,
  ): Promise<{ status: string; ownerId: string }> {
    const digest = hashToken(dto.token);
    const row = await this.inService((tx) =>
      tx.familyAccount.findFirst({ where: { inviteTokenHash: digest } }),
    );
    if (!row || !safeEqualHex(row.inviteTokenHash ?? '', digest)) {
      throw new NotFoundException('invite not found');
    }
    if (row.status !== 'pending') {
      throw new ForbiddenException('invite has already been used');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      await this.inService((tx) =>
        tx.familyAccount.update({ where: { id: row.id }, data: { status: 'expired' } }),
      );
      throw new ForbiddenException('invite has expired');
    }
    if (row.profileUserId === memberId) {
      throw new BadRequestException('cannot accept your own invite');
    }
    try {
      await this.inService((tx) =>
        tx.familyAccount.update({
          where: { id: row.id },
          data: {
            memberUserId: memberId,
            status: 'accepted',
            acceptedAt: new Date(),
            inviteTokenHash: null, // single-use
          },
        }),
      );
    } catch {
      // Unique (owner, member) — this member is already in the family.
      throw new ConflictException('already a member of this family');
    }
    logger.info({ ownerId: row.profileUserId, memberId }, 'family invite accepted');
    return { status: 'accepted', ownerId: row.profileUserId };
  }

  /** Invites/memberships visible to the caller (as owner and/or as member). */
  async listFor(userId: string) {
    const rows = await this.inService((tx) =>
      tx.familyAccount.findMany({
        where: { OR: [{ profileUserId: userId }, { memberUserId: userId }] },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return rows.map((r) => ({
      inviteId: r.id,
      ownerId: r.profileUserId,
      memberId: r.memberUserId,
      relation: r.relation,
      permissions: perms(r),
      status: r.status,
      expiresAt: r.expiresAt,
      acceptedAt: r.acceptedAt,
      // True when the caller is the member side of this row.
      amMember: r.memberUserId === userId,
    }));
  }

  // ---- Membership resolution (member-side authz) ------------------------------

  /**
   * Resolves the caller's accepted membership, enforces the D7 permission
   * bit and the owner's live family_mode consent. `ownerId` is required
   * when the caller belongs to more than one family.
   */
  private async resolveMembership(
    memberId: string,
    ownerId: string | undefined,
    need: 'view' | 'comment',
  ) {
    const rows = await this.inService((tx) =>
      tx.familyAccount.findMany({
        where: { memberUserId: memberId, status: 'accepted' },
      }),
    );
    if (rows.length === 0) {
      throw new ForbiddenException('not a family member');
    }
    let row;
    if (ownerId) {
      row = rows.find((r) => r.profileUserId === ownerId);
      if (!row) throw new ForbiddenException('not a family member of this owner');
    } else if (rows.length === 1) {
      row = rows[0]!;
    } else {
      throw new BadRequestException('ownerId is required (member of multiple families)');
    }
    const p = perms(row);
    if (need === 'view' && !p.view) throw new ForbiddenException('family view permission required');
    if (need === 'comment' && !p.comment) {
      throw new ForbiddenException('family comment permission required (owner approves)');
    }
    await this.assertFamilyConsent(row.profileUserId);
    return row;
  }

  // ---- Shortlist view (A7 tool: get_family_view) ------------------------------

  async getShortlist(memberId: string, ownerId?: string) {
    const row = await this.resolveMembership(memberId, ownerId, 'view');
    const cards = await this.matching.getShortlistCards(row.profileUserId);
    return { ownerId: row.profileUserId, cards };
  }

  // ---- Feedback (A7 tool: save_family_feedback) -------------------------------

  async saveFeedback(memberId: string, dto: FamilyFeedbackDto) {
    const row = await this.resolveMembership(memberId, dto.ownerId, 'comment');
    const commentEnc = dto.comment ? await this.crypto.encrypt(dto.comment) : null;
    const created = await this.inService(async (tx) => {
      // Feedback must reference a live shortlisted candidate of the owner.
      const shortlisted = await tx.interaction.findUnique({
        where: {
          actorUserId_targetUserId_type: {
            actorUserId: row.profileUserId,
            targetUserId: dto.candidateId,
            type: 'shortlist',
          },
        },
      });
      if (!shortlisted) {
        throw new BadRequestException('candidate is not on the owner’s shortlist');
      }
      return tx.familyFeedback.create({
        data: {
          familyAccountId: row.id,
          familyMemberId: memberId,
          profileUserId: row.profileUserId,
          candidateId: dto.candidateId,
          signal: dto.signal,
          commentEnc: commentEnc ? Uint8Array.from(commentEnc) : undefined,
        },
      });
    });
    logger.info(
      { ownerId: row.profileUserId, memberId, candidateId: dto.candidateId, signal: dto.signal },
      'family feedback recorded',
    );
    return { id: created.id, signal: created.signal };
  }

  private async decryptComment(enc: Uint8Array | null): Promise<string | null> {
    if (!enc) return null;
    return this.crypto.decrypt(Buffer.from(enc));
  }

  /** Owner: all feedback on their shortlist. Member: own rows (view-gated). */
  async listFeedback(userId: string, ownerId?: string) {
    const isOwnerRequest = !ownerId || ownerId === userId;
    if (isOwnerRequest) {
      const rows = await this.inService((tx) =>
        tx.familyFeedback.findMany({
          where: { profileUserId: userId },
          orderBy: { createdAt: 'desc' },
        }),
      );
      return {
        ownerId: userId,
        rows: await Promise.all(
          rows.map(async (r) => ({
            id: r.id,
            candidateId: r.candidateId,
            familyMemberId: r.familyMemberId,
            signal: r.signal,
            comment: await this.decryptComment(r.commentEnc),
            createdAt: r.createdAt,
          })),
        ),
      };
    }
    await this.resolveMembership(userId, ownerId, 'view');
    const rows = await this.inService((tx) =>
      tx.familyFeedback.findMany({
        where: { profileUserId: ownerId, familyMemberId: userId },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return {
      ownerId,
      rows: await Promise.all(
        rows.map(async (r) => ({
          id: r.id,
          candidateId: r.candidateId,
          familyMemberId: r.familyMemberId,
          signal: r.signal,
          comment: await this.decryptComment(r.commentEnc),
          createdAt: r.createdAt,
        })),
      ),
    };
  }

  // ---- A7 summary --------------------------------------------------------------

  async getSummary(userId: string, ownerId?: string) {
    let owner: string;
    if (!ownerId || ownerId === userId) {
      owner = userId; // owner reading their own family digest
    } else {
      const row = await this.resolveMembership(userId, ownerId, 'view');
      owner = row.profileUserId;
    }
    const rows = await this.inService((tx) =>
      tx.familyFeedback.findMany({
        where: { profileUserId: owner },
        select: { candidateId: true, signal: true },
      }),
    );
    const byCandidate = new Map<string, string[]>();
    for (const r of rows) {
      const list = byCandidate.get(r.candidateId) ?? [];
      list.push(r.signal);
      byCandidate.set(r.candidateId, list);
    }
    const localeRow = await this.inService((tx) =>
      tx.user.findUnique({ where: { id: owner }, select: { locale: true } }),
    );
    const locale = localeRow?.locale ?? 'en';
    const summary = await this.summariser.summarise({
      ownerId: owner,
      locale,
      items: [...byCandidate.entries()].map(([candidateId, signals]) => ({
        candidateId,
        signals,
      })),
    });
    return { ownerId: owner, locale, summary };
  }
}
