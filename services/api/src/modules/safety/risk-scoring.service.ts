/**
 * A3 risk scoring (P2-04, DESIGN.md A3).
 *
 * P2 scope is a DETERMINISTIC rules engine — every signal is auditable, no LLM
 * in the loop (an LLM-assisted deep-check pass can join later without changing
 * this surface; recorded as an ADR at phase exit). Signals:
 *   - failed KYC (recent, not underage)     +30
 *   - name mismatch on a passed KYC         +20
 *   - open reports against the user         +25 each, capped +50
 *   - photo pHash reused by another account +40 (ban-evasion signal, T8)
 *   - underage attempt                      hard signal → critical case
 *     (the account itself is blocked by the KYC flow)
 *
 * Rule (A3 exit): score >= threshold → ONE open safety case (human review
 * queue). Cases NEVER auto-ban.
 *
 * Recomputed on: KYC result, report filed, photo moderated. Idempotent and
 * cheap; safe to call on every safety event.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createLogger } from '@saath/logger';
import { PrismaService } from '../../prisma/prisma.service';

const logger = createLogger('risk');

export const RISK_WEIGHTS = {
  kycFail: 30,
  nameMismatch: 20,
  openReport: 25,
  openReportCap: 50,
  reusedPhoto: 40,
} as const;

/** Score at (or above) which a human-review case opens (config, rule 13). */
export const DEFAULT_RISK_CASE_THRESHOLD = 60;

export interface RiskSignal {
  signal: string;
  weight: number;
  detail: string;
}

@Injectable()
export class RiskScoringService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Recompute the user's score from current data, persist it, and open a
   * deduped safety case at/above the threshold.
   */
  async recalculate(userId: string, threshold = DEFAULT_RISK_CASE_THRESHOLD) {
    const signals: RiskSignal[] = [];
    let score = 0;

    const data = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'risk', true)`;
      const [latestKyc, openReports, photoDupes, underage] = await Promise.all([
        tx.kycCheck.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
        tx.userReport.findMany({ where: { subjectId: userId, status: 'open' } }),
        // pHash reuse by a DIFFERENT account (visible photos only).
        tx.photo.findMany({
          where: { userId, moderationStatus: { not: 'rejected' }, phash: { not: null } },
          select: { phash: true },
        }),
        tx.kycCheck.findFirst({
          where: { userId, failureReason: 'underage' },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      let reusedPhoto = 0;
      for (const p of photoDupes) {
        if (!p.phash) continue;
        const dupe = await tx.photo.findFirst({
          where: { phash: p.phash, userId: { not: userId }, moderationStatus: { not: 'rejected' } },
          select: { userId: true },
        });
        if (dupe) reusedPhoto += 1;
      }
      return { latestKyc, openReports, underage, reusedPhoto };
    });

    if (data.underage) {
      signals.push({ signal: 'underage_attempt', weight: 0, detail: 'hard signal' });
    }
    if (data.latestKyc?.status === 'fail' && data.latestKyc.failureReason !== 'underage') {
      signals.push({
        signal: 'kyc_fail',
        weight: RISK_WEIGHTS.kycFail,
        detail: data.latestKyc.type,
      });
      score += RISK_WEIGHTS.kycFail;
    }
    if (data.latestKyc?.status === 'pass' && data.latestKyc.nameMatch === false) {
      signals.push({
        signal: 'name_mismatch',
        weight: RISK_WEIGHTS.nameMismatch,
        detail: 'kyc pass',
      });
      score += RISK_WEIGHTS.nameMismatch;
    }
    if (data.openReports.length > 0) {
      const w = Math.min(
        data.openReports.length * RISK_WEIGHTS.openReport,
        RISK_WEIGHTS.openReportCap,
      );
      signals.push({
        signal: 'open_reports',
        weight: w,
        detail: `${data.openReports.length} open`,
      });
      score += w;
    }
    if (data.reusedPhoto > 0) {
      signals.push({
        signal: 'reused_photo',
        weight: RISK_WEIGHTS.reusedPhoto * data.reusedPhoto,
        detail: `${data.reusedPhoto} duplicate pHash`,
      });
      score += RISK_WEIGHTS.reusedPhoto * data.reusedPhoto;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'risk', true)`;
      await tx.riskScore.upsert({
        where: { userId },
        update: {
          score,
          signals: signals as unknown as Prisma.InputJsonValue,
          computedAt: new Date(),
        },
        create: { userId, score, signals: signals as unknown as Prisma.InputJsonValue },
      });
    });

    const severity = data.underage
      ? 'critical'
      : score >= 80
        ? 'high'
        : score >= threshold
          ? 'medium'
          : null;
    if (severity) {
      await this.openCase(userId, data.underage ? 'kyc' : 'risk', severity);
    }
    logger.info({ userId, score, signals: signals.length }, 'risk score recomputed');
    return { score, signals };
  }

  /** One open case per subject+source — re-thresholding never floods the queue. */
  async openCase(subjectId: string, source: string, severity: string): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'risk', true)`;
      const existing = await tx.safetyCase.findFirst({
        where: { subjectId, source, status: 'open' },
      });
      if (existing) return existing.id;
      const created = await tx.safetyCase.create({ data: { subjectId, source, severity } });
      logger.info({ subjectId, source, severity }, 'safety case opened');
      return created.id;
    });
  }

  /** The user's own score (for GET /v1/me/risk). */
  async getOwnRisk(userId: string) {
    const row = await this.prisma.withUser(userId, (tx) =>
      tx.riskScore.findUnique({ where: { userId } }),
    );
    return {
      score: row?.score ?? 0,
      signals: (row?.signals as RiskSignal[] | undefined) ?? [],
      computedAt: row?.computedAt.toISOString() ?? null,
    };
  }
}
