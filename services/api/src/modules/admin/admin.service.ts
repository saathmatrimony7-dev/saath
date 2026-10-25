/**
 * Admin service (P2-06): JIT elevation, the user directory (C4-masked by
 * default), the safety-case queue, and audit browsing. All reads/writes run
 * in the 'admin' service context (RLS); authorisation is the AdminGuard's
 * job (defence in depth, T7).
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createLogger } from '@saath/logger';
import type { AppConfig } from '../../config';
import { PrismaService } from '../../prisma/prisma.service';
import { APP_CONFIG } from '../identity/tokens';

const logger = createLogger('admin');

const MASK = '••••••'; // C4 fields are never decrypted for admin v1 (T7)

@Injectable()
export class AdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Time-boxed elevation. Solo mode: self-grant is allowed and logged. */
  async elevate(userId: string, reason: string) {
    if (!reason.trim()) throw new BadRequestException('reason is required');
    const expiresAt = new Date(Date.now() + this.config.ADMIN_JIT_TTL_SEC * 1000);
    const elevation = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'admin', true)`;
      // One active elevation at a time.
      const active = await tx.adminElevation.findFirst({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      if (active) return active;
      return tx.adminElevation.create({
        data: { userId, grantedBy: userId, reason: reason.slice(0, 200), expiresAt },
      });
    });
    logger.warn({ userId, expiresAt }, 'admin JIT elevation granted (solo mode: self-grant)');
    return { elevationId: elevation.id, expiresAt: elevation.expiresAt.toISOString() };
  }

  async drop(userId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'admin', true)`;
      await tx.adminElevation.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return { dropped: true };
  }

  /** Recent signups directory. C4 masked: phone/email never decrypted. */
  async listUsers(limit = 50) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'admin', true)`;
      const rows = await tx.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 200),
        select: {
          id: true,
          role: true,
          status: true,
          locale: true,
          ageVerified: true,
          createdAt: true,
          lastActiveAt: true,
          profile: { select: { verificationTier: true, displayName: true, cityId: true } },
        },
      });
      return rows.map((u) => ({
        id: u.id,
        role: u.role,
        status: u.status,
        locale: u.locale,
        ageVerified: u.ageVerified,
        createdAt: u.createdAt.toISOString(),
        lastActiveAt: u.lastActiveAt?.toISOString() ?? null,
        verificationTier: u.profile?.verificationTier ?? 0,
        displayName: u.profile?.displayName ?? null,
        cityId: u.profile?.cityId ?? null,
        phone: MASK,
        email: MASK,
      }));
    });
  }

  /** Single user record (C4 masked) with safety context. */
  async getUser(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'admin', true)`;
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          status: true,
          locale: true,
          ageVerified: true,
          birthYear: true,
          createdAt: true,
          lastActiveAt: true,
          profile: {
            select: { verificationTier: true, displayName: true, visibility: true, cityId: true },
          },
          riskScore: { select: { score: true, computedAt: true } },
          consents: { orderBy: { createdAt: 'desc' }, take: 20 },
          kycChecks: { orderBy: { createdAt: 'desc' }, take: 5 },
          _count: { select: { reportsReceived: true, safetyCases: true } },
        },
      });
      if (!user) throw new NotFoundException('user not found');
      return {
        id: user.id,
        role: user.role,
        status: user.status,
        locale: user.locale,
        ageVerified: user.ageVerified,
        birthYear: user.birthYear,
        createdAt: user.createdAt.toISOString(),
        lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
        verificationTier: user.profile?.verificationTier ?? 0,
        displayName: user.profile?.displayName ?? null,
        visibility: user.profile?.visibility ?? null,
        cityId: user.profile?.cityId ?? null,
        phone: MASK,
        email: MASK,
        riskScore: user.riskScore?.score ?? 0,
        riskComputedAt: user.riskScore?.computedAt.toISOString() ?? null,
        openReports: user._count.reportsReceived,
        safetyCases: user._count.safetyCases,
        kyc: user.kycChecks.map((k) => ({
          type: k.type,
          status: k.status,
          at: k.createdAt.toISOString(),
        })),
        consents: user.consents.map((c) => ({
          purpose: c.purpose,
          granted: c.granted,
          at: c.createdAt.toISOString(),
        })),
      };
    });
  }

  /** Human review queue (P2-04). */
  async listCases(status = 'open') {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'admin', true)`;
      const rows = await tx.safetyCase.findMany({
        where: { status },
        orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
        take: 200,
      });
      return rows.map((c) => ({
        id: c.id,
        subjectId: c.subjectId,
        source: c.source,
        severity: c.severity,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      }));
    });
  }

  async decideCase(
    actorId: string,
    caseId: string,
    status: 'resolved' | 'dismissed',
    decision: string,
  ) {
    if (!decision.trim()) throw new BadRequestException('decision is required');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'admin', true)`;
      const existing = await tx.safetyCase.findUnique({ where: { id: caseId } });
      if (!existing) throw new NotFoundException('case not found');
      if (existing.status !== 'open' && existing.status !== 'reviewing') {
        throw new BadRequestException(`case is ${existing.status}`);
      }
      return tx.safetyCase.update({
        where: { id: caseId },
        data: {
          status,
          decision: decision.slice(0, 500),
          decidedBy: actorId,
          decidedAt: new Date(),
        },
      });
    });
  }
}
