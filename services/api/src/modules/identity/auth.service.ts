/**
 * Auth orchestration: OTP verify → find-or-create user → session with
 * rotating refresh token. All DB access is RLS-checked: pre-auth lookups run
 * in the identity-service context, user writes run under the owner's context.
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FieldCrypto } from '@saath/crypto';
import { createLogger } from '@saath/logger';
import type { AppConfig } from '../../config';
import type { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from './token.service';
import type { OtpService } from './otp.service';
import { SIGNUP_PURPOSES } from '../consent/consent.consts';

const logger = createLogger('identity');

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: FieldCrypto,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
  ) {}

  async requestOtp(phoneE164: string, ipHash: string): Promise<void> {
    await this.otp.request(phoneE164, ipHash);
    logger.info('otp requested'); // phone never logged (rule 8)
  }

  async verifyOtpAndLogin(phoneE164: string, code: string, ipHash: string, ua?: string) {
    const ok = await this.otp.verify(phoneE164, code);
    if (!ok) throw new UnauthorizedException('invalid OTP');

    const phoneHash = await this.crypto.hashLookup(phoneE164);

    // Find-or-create user. The pre-auth lookup runs in identity-service context.
    const userId = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'identity', true)`;
      const existing = await tx.user.findUnique({ where: { phoneHash } });
      if (existing) return existing.id;

      // New user: insert under its OWN context (WITH CHECK requires id == GUC).
      const id = randomUUID();
      const phoneEnc = Uint8Array.from(await this.crypto.encrypt(phoneE164));
      // Nested transaction context switch: same tx, switch GUC to the new user.
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${id}, true)`;
      await tx.user.create({
        data: { id, phoneHash, phoneEnc, status: 'active', ageVerified: false },
      });
      // P1-02: consent ledger starts at signup (notice shown pre-verification).
      // Append-only rows under the new owner's RLS context, same transaction.
      for (const purpose of SIGNUP_PURPOSES) {
        await tx.consent.create({
          data: {
            userId: id,
            purpose,
            granted: true,
            channel: 'otp_signup',
            noticeVersion: this.config.CONSENT_NOTICE_VERSION,
          },
        });
      }
      return id;
    });

    return this.issueSession(userId, ipHash, ua);
  }

  private async issueSession(userId: string, ipHash?: string, ua?: string): Promise<IssuedTokens> {
    const sessionId = randomUUID();
    const { token: refreshToken, hash } = this.tokens.generateRefreshToken();
    const expiresAt = new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_SEC * 1000);
    const role = await this.prisma.withUser(userId, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { role: true },
      });
      return user.role;
    });

    await this.prisma.withUser(userId, async (tx) => {
      await tx.session.create({
        data: {
          id: sessionId,
          userId,
          refreshTokenHash: hash,
          ipHash,
          ua: ua?.slice(0, 256),
          expiresAt,
        },
      });
      await tx.user.update({ where: { id: userId }, data: { lastActiveAt: new Date() } });
    });

    const accessToken = await this.tokens.signAccessToken({ sub: userId, sid: sessionId, role });
    logger.info({ userId, sessionId }, 'session issued');
    return { accessToken, refreshToken, userId };
  }

  /** Rotates the refresh token; reuse of a rotated token revokes the session. */
  async refresh(presentedToken: string): Promise<IssuedTokens> {
    const presentedHash = TokenService.hashRefreshToken(presentedToken);

    const session = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'identity', true)`;
      return tx.session.findUnique({
        where: { refreshTokenHash: presentedHash },
        include: { user: { select: { role: true } } },
      });
    });

    if (!session) {
      // Maybe a rotated (previous) token is being replayed → theft signal.
      await this.revokeByPreviousHash(presentedHash);
      throw new UnauthorizedException('invalid refresh token');
    }
    if (session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('session expired or revoked');
    }

    const next = this.tokens.generateRefreshToken();
    await this.prisma.withUser(session.userId, async (tx) => {
      await tx.session.update({
        where: { id: session.id },
        data: {
          refreshTokenHash: next.hash,
          previousRefreshTokenHash: presentedHash, // replay of this = reuse
        },
      });
    });

    const accessToken = await this.tokens.signAccessToken({
      sub: session.userId,
      sid: session.id,
      role: session.user?.role ?? 'member',
    });
    logger.info({ sessionId: session.id }, 'refresh token rotated');
    return { accessToken, refreshToken: next.token, userId: session.userId };
  }

  private async revokeByPreviousHash(previousHash: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'identity', true)`;
      const res = await tx.session.updateMany({
        where: { previousRefreshTokenHash: previousHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (res.count > 0) {
        logger.warn({ sessionRevoked: true }, 'refresh token reuse detected — session revoked');
      }
    });
  }

  async logout(presentedToken: string): Promise<void> {
    const hash = TokenService.hashRefreshToken(presentedToken);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'identity', true)`;
      await tx.session.updateMany({
        where: { refreshTokenHash: hash },
        data: { revokedAt: new Date() },
      });
    });
    logger.info('session revoked (logout)');
  }

  hashIp(ip: string): Promise<string> {
    return this.crypto.hashLookup(`ip:${ip}`);
  }
}
