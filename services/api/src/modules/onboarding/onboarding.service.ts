/**
 * Onboarding orchestration (P1-06). Owns session/message persistence; the
 * conversation itself comes from the OnboardingEngine (mock scripted engine
 * or the Python A1 over HTTP). The profile only goes live on explicit
 * confirm — never as a side effect of the interview (P1-06 exit).
 */
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createLogger } from '@saath/logger';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfilesService } from '../profiles/profiles.service';
import type { OnboardingEngine } from './engine';
import { ONBOARDING_ENGINE } from './tokens';
import type { ConfirmSessionDto, CreateSessionDto, PostMessageDto } from './onboarding.dto';

const logger = createLogger('onboarding');

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ONBOARDING_ENGINE) private readonly engine: OnboardingEngine,
    @Inject(ProfilesService) private readonly profiles: ProfilesService,
  ) {}

  /** Starts a new interview or resumes the latest in-progress one. */
  async start(userId: string, dto: CreateSessionDto) {
    return this.prisma.withUser(userId, async (tx) => {
      const existing = await tx.onboardingSession.findFirst({
        where: { userId, status: 'in_progress' },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        const lastMsg = await tx.onboardingMessage.findFirst({
          where: { sessionId: existing.id },
          orderBy: { seq: 'desc' },
        });
        return {
          sessionId: existing.id,
          status: existing.status,
          message: lastMsg?.content ?? this.engine.greeting(existing.locale),
          resumed: true,
        };
      }
      const session = await tx.onboardingSession.create({
        data: { userId, locale: dto.locale },
      });
      const greeting = this.engine.greeting(dto.locale);
      await tx.onboardingMessage.create({
        data: { sessionId: session.id, role: 'assistant', content: greeting, seq: 0 },
      });
      logger.info({ userId, sessionId: session.id }, 'onboarding session started');
      return { sessionId: session.id, status: session.status, message: greeting, resumed: false };
    });
  }

  /** One interview turn: persists both messages, returns the assistant reply. */
  async takeTurn(userId: string, sessionId: string, dto: PostMessageDto) {
    const session = await this.prisma.withUser(userId, (tx) =>
      tx.onboardingSession.findUnique({ where: { id: sessionId } }),
    );
    if (!session || session.userId !== userId) throw new NotFoundException('session not found');
    if (session.status !== 'in_progress') {
      throw new ConflictException(`session is ${session.status}`);
    }

    const result = await this.prisma.withUser(userId, async (tx) => {
      const seqBase = session.turnCount * 2 + 1;
      await tx.onboardingMessage.create({
        data: { sessionId, role: 'user', content: dto.text, seq: seqBase },
      });

      const history = await tx.onboardingMessage.findMany({
        where: { sessionId },
        orderBy: { seq: 'asc' },
      });
      let out;
      try {
        out = await this.engine.takeTurn({
          sessionId,
          userId,
          locale: session.locale,
          turnCount: session.turnCount,
          userText: dto.text,
          history: history.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
        });
      } catch (err) {
        logger.error({ userId, sessionId, err }, 'onboarding engine turn failed');
        throw new ServiceUnavailableException('onboarding engine unavailable');
      }

      await tx.onboardingMessage.create({
        data: { sessionId, role: 'assistant', content: out.replyText, seq: seqBase + 1 },
      });
      const updated = await tx.onboardingSession.update({
        where: { id: sessionId },
        data: { turnCount: { increment: 1 }, status: out.status },
      });
      return { replyText: out.replyText, status: updated.status, turnCount: updated.turnCount };
    });
    logger.info({ userId, sessionId, status: result.status }, 'onboarding turn taken');
    return result;
  }

  /**
   * Explicit user confirmation — the ONLY path that makes the profile live.
   * Awaiting_confirm → confirmed + profile visibility flips from hidden.
   */
  async confirm(userId: string, dto: ConfirmSessionDto) {
    const session = await this.prisma.withUser(userId, (tx) =>
      tx.onboardingSession.findUnique({ where: { id: dto.sessionId } }),
    );
    if (!session || session.userId !== userId) throw new NotFoundException('session not found');
    if (session.status === 'confirmed') return { confirmed: true, already: true };
    if (session.status !== 'awaiting_confirm') {
      throw new ConflictException('interview is not ready for confirmation');
    }

    await this.prisma.withUser(userId, (tx) =>
      tx.onboardingSession.update({
        where: { id: session.id },
        data: { status: 'confirmed' },
      }),
    );
    await this.profiles.patchProfile(userId, { visibility: 'members' });
    logger.info({ userId, sessionId: session.id }, 'onboarding confirmed — profile live');
    return { confirmed: true, already: false };
  }

  /** Latest session for the user (any status) — used by channels (P1-09). */
  async latest(userId: string) {
    return this.prisma.withUser(userId, (tx) =>
      tx.onboardingSession.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    );
  }

  async transcript(userId: string, sessionId: string) {
    const session = await this.prisma.withUser(userId, (tx) =>
      tx.onboardingSession.findUnique({ where: { id: sessionId } }),
    );
    if (!session || session.userId !== userId) throw new NotFoundException('session not found');
    const messages = await this.prisma.withUser(userId, (tx) =>
      tx.onboardingMessage.findMany({ where: { sessionId }, orderBy: { seq: 'asc' } }),
    );
    return { session, messages };
  }
}
