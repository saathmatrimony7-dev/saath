/**
 * Admin audit trail (P2-06, DESIGN.md T7 — exit criterion 3):
 * append-only, service-context writes, ids/kinds only (never record contents
 * or C4 data). Every admin handler calls `record` for BOTH views and actions.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createLogger } from '@saath/logger';
import { PrismaService } from '../../prisma/prisma.service';

const logger = createLogger('admin-audit');

@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(
    actorId: string,
    action: string,
    subjectKind: string,
    subjectId?: string,
    meta: Record<string, unknown> = {},
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'admin', true)`;
      await tx.adminAudit.create({
        data: {
          actorId,
          action,
          subjectKind,
          subjectId: subjectId ?? null,
          meta: meta as unknown as Prisma.InputJsonValue,
        },
      });
    });
    logger.info({ actorId, action, subjectKind }, 'admin audit recorded');
  }

  /** Recent audit rows (admin audit browser). */
  async recent(limit = 50) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'admin', true)`;
      const rows = await tx.adminAudit.findMany({
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 200),
      });
      return rows.map((r) => ({
        id: r.id,
        actorId: r.actorId,
        action: r.action,
        subjectKind: r.subjectKind,
        subjectId: r.subjectId,
        meta: r.meta,
        at: r.createdAt.toISOString(),
      }));
    });
  }
}
