/**
 * Safety service (P2-03): reports & blocks (DESIGN.md J9/T8).
 *
 * - Reports are append-only from the app role; deduped per open
 *   reporter+subject pair so a spammer cannot flood the queue (an open report
 *   is returned idempotently).
 * - Blocks are idempotent upserts; a blocked pair hides profiles BOTH
 *   directions (wired into getPublicProfile here; match/chat surfaces check
 *   `isBlockedEitherWay` when they land in P3/P4).
 * - Subject/target existence is checked in the dedicated 'safety' service
 *   context (RLS); foreign or unknown users are indistinguishable (404).
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createLogger } from '@saath/logger';
import { PrismaService } from '../../prisma/prisma.service';
import type { ReportUserDto } from './safety.dto';

const logger = createLogger('safety');

@Injectable()
export class SafetyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Pre-auth existence check in the safety service context (RLS). */
  private async findUser(id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'safety', true)`;
      return tx.user.findUnique({ where: { id } });
    });
  }

  async report(reporterId: string, subjectId: string, dto: ReportUserDto) {
    if (reporterId === subjectId) throw new BadRequestException('cannot report yourself');
    const subject = await this.findUser(subjectId);
    if (!subject) throw new NotFoundException('user not found');

    // Dedupe: one open report per reporter+subject pair.
    const existing = await this.prisma.withUser(reporterId, (tx) =>
      tx.userReport.findFirst({ where: { reporterId, subjectId, status: 'open' } }),
    );
    if (existing) return { reportId: existing.id, already: true };

    const report = await this.prisma.withUser(reporterId, (tx) =>
      tx.userReport.create({
        data: { reporterId, subjectId, reason: dto.reason, details: dto.details ?? null },
      }),
    );
    logger.info({ reporterId, subjectId, reason: dto.reason }, 'user reported');
    return { reportId: report.id, already: false };
  }

  /** True when either direction of the pair is blocked (service context:
   * the caller may not be able to SEE the other direction's row under RLS). */
  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    if (a === b) return false;
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'safety', true)`;
      return tx.block.findFirst({
        where: {
          OR: [
            { blockerId: a, blockedId: b },
            { blockerId: b, blockedId: a },
          ],
        },
      });
    });
    return row !== null;
  }

  async block(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) throw new BadRequestException('cannot block yourself');
    const target = await this.findUser(blockedId);
    if (!target) throw new NotFoundException('user not found');

    const existing = await this.prisma.withUser(blockerId, (tx) =>
      tx.block.findUnique({ where: { blockerId_blockedId: { blockerId, blockedId } } }),
    );
    if (existing) return { blocked: true, already: true };
    await this.prisma.withUser(blockerId, (tx) =>
      tx.block.create({ data: { blockerId, blockedId } }),
    );
    logger.info({ blockerId, blockedId }, 'user blocked');
    return { blocked: true, already: false };
  }

  async unblock(blockerId: string, blockedId: string) {
    await this.prisma.withUser(
      blockerId,
      (tx) =>
        tx.block
          .delete({ where: { blockerId_blockedId: { blockerId, blockedId } } })
          .catch(() => undefined), // idempotent unblock
    );
    return { blocked: false };
  }

  async listBlocks(userId: string) {
    const blocks = await this.prisma.withUser(userId, (tx) =>
      tx.block.findMany({ where: { blockerId: userId }, orderBy: { createdAt: 'desc' } }),
    );
    // Never expose phone/name here — ids only; the client shows its own labels.
    return {
      blocks: blocks.map((b) => ({ userId: b.blockedId, since: b.createdAt.toISOString() })),
    };
  }
}
