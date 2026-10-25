/**
 * KYC orchestration (P2-01, DESIGN.md A6/A10.4).
 *
 * Flow: consent gate (purpose 'kyc') → provider.start (pending row) →
 * signature-verified webhook result → tier/age updates.
 *
 * Guarantees:
 * - raw documents never touch our tables (results only, §10.4);
 * - underage (provider age < 18) is a hard signal: immediate block (T10);
 * - tiers are monotonic (a later failing check never lowers a tier);
 * - the webhook is idempotent (event ids in webhook_events, rule 12).
 */
import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { createLogger } from '@saath/logger';
import { PrismaService } from '../../prisma/prisma.service';
import { ConsentService } from '../consent/consent.service';
import { RiskScoringService } from '../safety/risk-scoring.service';
import { KYC_PROVIDER_TOKEN } from './tokens';
import type { KycProvider } from './provider';
import type { KycWebhookDto, StartKycDto } from './kyc.dto';

const logger = createLogger('kyc');

/** Verification tiers (DESIGN.md J3): 0 none, 1 ID, 2 +liveness, 3 +employment. */
const TIER_BY_TYPE: Record<string, number> = {
  id: 1,
  id_liveness: 2,
  employment: 3,
};
/** Employment verification builds on an ID-verified account (stub tier, P2). */
const TIER_PREREQUISITE: Record<string, number> = {
  employment: 2,
};

@Injectable()
export class KycService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConsentService) private readonly consents: ConsentService,
    @Inject(KYC_PROVIDER_TOKEN) private readonly provider: KycProvider,
    @Inject(RiskScoringService) private readonly risk: RiskScoringService,
  ) {}

  /** Starts a check. Requires the kyc consent purpose and an active account. */
  async start(userId: string, dto: StartKycDto) {
    const consent = (await this.consents.latest(userId)).find((c) => c.purpose === 'kyc');
    if (!consent?.granted) {
      throw new ForbiddenException('kyc consent is required before starting verification');
    }
    const user = await this.prisma.withUser(userId, (tx) =>
      tx.user.findUnique({ where: { id: userId } }),
    );
    if (!user || user.status !== 'active') {
      throw new ForbiddenException('account is not active');
    }
    const pending = await this.prisma.withUser(userId, (tx) =>
      tx.kycCheck.findFirst({ where: { userId, status: 'pending' } }),
    );
    if (pending) throw new ConflictException('a verification check is already in progress');

    const { providerRef } = await this.provider.start({ userId, type: dto.type });
    const check = await this.prisma.withUser(userId, (tx) =>
      tx.kycCheck.create({
        data: { userId, provider: this.provider.name, providerRef, type: dto.type },
      }),
    );
    logger.info({ userId, type: dto.type }, 'kyc check started');
    return { checkId: check.id, providerRef, status: check.status };
  }

  /** Latest check for the user (for the status UI). */
  async latest(userId: string) {
    const check = await this.prisma.withUser(userId, (tx) =>
      tx.kycCheck.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    );
    if (!check) return null;
    return {
      checkId: check.id,
      type: check.type,
      status: check.status,
      tier: await this.currentTier(userId),
      updatedAt: check.updatedAt.toISOString(),
    };
  }

  /** Result delivery from the provider webhook (service context). */
  async handleWebhook(dto: KycWebhookDto): Promise<void> {
    // Idempotency (rule 12): first writer wins; replays are ignored.
    const already = await this.prisma.webhookEvent.findUnique({ where: { id: dto.event_id } });
    if (already) return;
    try {
      await this.prisma.webhookEvent.create({ data: { id: dto.event_id, source: 'kyc' } });
    } catch {
      return; // concurrent delivery of the same event
    }

    const check = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'verification', true)`;
      return tx.kycCheck.findFirst({ where: { providerRef: dto.provider_ref } });
    });
    if (!check) {
      logger.info(
        { providerRef: dto.provider_ref },
        'kyc webhook for unknown provider_ref ignored',
      );
      return;
    }
    if (check.status !== 'pending') {
      logger.info({ providerRef: dto.provider_ref }, 'kyc webhook for processed check ignored');
      return;
    }

    // Hard signal (T10): provider says the user is underage → block now.
    const underage = dto.age !== undefined && dto.age < 18;
    const status =
      dto.result === 'pass' && !underage ? 'pass' : dto.result === 'error' ? 'error' : 'fail';
    const failureReason = underage ? 'underage' : (dto.failure_reason ?? null);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'verification', true)`;
      await tx.kycCheck.update({
        where: { id: check.id },
        data: {
          status,
          score: dto.score ?? null,
          age: dto.age ?? null,
          nameMatch: dto.name_match ?? null,
          maskedId: dto.masked_id ?? null,
          failureReason,
        },
      });
    });

    if (status === 'pass') {
      await this.applyPass(check.userId, check.type, dto.age);
    } else if (underage) {
      await this.blockUnderage(check.userId);
    }
    await this.risk.recalculate(check.userId); // A3: KYC outcome feeds the score
    logger.info({ userId: check.userId, status, type: check.type }, 'kyc result processed');
  }

  private async applyPass(userId: string, type: string, age: number | undefined) {
    const prerequisite = TIER_PREREQUISITE[type] ?? 0;
    const current = await this.currentTier(userId);
    if (current < prerequisite) {
      logger.info({ userId, type }, 'kyc pass ignored: prerequisite tier not met');
      return;
    }
    const tier = Math.max(current, TIER_BY_TYPE[type] ?? current);
    const birthYear = age !== undefined ? new Date().getFullYear() - age : undefined;

    await this.prisma.withUser(userId, async (tx) => {
      // The profile may not exist yet (KYC before onboarding completion).
      await tx.profile.upsert({
        where: { userId },
        update: { verificationTier: tier, profileVersion: { increment: 1 } },
        create: { userId, verificationTier: tier },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          ageVerified: age !== undefined && age >= 18,
          ...(birthYear !== undefined ? { birthYear } : {}),
        },
      });
    });
  }

  private async blockUnderage(userId: string) {
    await this.prisma.withUser(userId, async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status: 'blocked' } });
    });
    logger.warn({ userId }, 'underage user blocked (hard signal T10)');
  }

  private async currentTier(userId: string): Promise<number> {
    const profile = await this.prisma.withUser(userId, (tx) =>
      tx.profile.findUnique({ where: { userId } }),
    );
    return profile?.verificationTier ?? 0;
  }

  /**
   * P2 exit criterion 1 ("unverified users cannot message"):
   * the single precondition the P4 messaging path must call before delivering
   * any user-to-user message. Throws ForbiddenException with machine-readable
   * reasons; `verificationStatus` is the same check in reporting form for the
   * `GET /v1/me/verification` UI.
   */
  async verificationStatus(userId: string) {
    const user = await this.prisma.withUser(userId, (tx) =>
      tx.user.findUnique({ where: { id: userId } }),
    );
    const tier = await this.currentTier(userId);
    const reasons: string[] = [];
    if (!user || user.status !== 'active') reasons.push('account_blocked');
    if (tier < 1) reasons.push('verification_required');
    if (!user?.ageVerified) reasons.push('age_unverified');
    return {
      status: user?.status ?? 'unknown',
      tier,
      ageVerified: user?.ageVerified ?? false,
      canContact: reasons.length === 0,
      reasons,
    };
  }

  /** Hard gate for user-to-user messaging (call before delivering a message). */
  async assertCanContact(userId: string): Promise<void> {
    const v = await this.verificationStatus(userId);
    if (!v.canContact) {
      throw new ForbiddenException({ message: 'contact is not permitted', reasons: v.reasons });
    }
  }
}
