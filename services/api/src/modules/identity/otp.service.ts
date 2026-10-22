/**
 * OTP lifecycle (DESIGN.md §12.2):
 * 6-digit code, 5-minute expiry, max 3 attempts per code, max 5 requests/hour
 * per phone and per IP. Codes are stored HMAC-peppered — never plaintext.
 */
import { randomInt, createHmac } from 'node:crypto';
import type { FieldCrypto } from '@saath/crypto';
import type { RlsPrismaClient } from '../../prisma/rls-prisma.client';
import type { AppConfig } from '../../config';
import type { SmsProvider } from './sms/sms-provider';
import type { RateLimiter } from './rate-limit';

export class OtpError extends Error {
  constructor(
    readonly code: 'RATE_LIMITED' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'INVALID',
    message: string,
  ) {
    super(message);
  }
}

export class OtpService {
  constructor(
    private readonly prisma: RlsPrismaClient,
    private readonly crypto: FieldCrypto,
    private readonly sms: SmsProvider,
    private readonly rateLimiter: RateLimiter,
    private readonly config: AppConfig,
  ) {}

  private hashCode(phoneE164: string, code: string): string {
    return createHmac('sha256', this.config.OTP_PEPPER)
      .update(`${phoneE164}:${code}`)
      .digest('hex');
  }

  async request(phoneE164: string, ipHash: string): Promise<void> {
    const phoneHash = await this.crypto.hashLookup(phoneE164);
    const window = 3600;

    const phoneOk = await this.rateLimiter.allow(
      `otp:req:phone:${phoneHash}`,
      this.config.OTP_REQUESTS_PER_HOUR,
      window,
    );
    const ipOk = await this.rateLimiter.allow(
      `otp:req:ip:${ipHash}`,
      this.config.OTP_IP_REQUESTS_PER_HOUR,
      window,
    );
    if (!phoneOk || !ipOk) {
      throw new OtpError('RATE_LIMITED', 'Too many OTP requests. Try again later.');
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = this.hashCode(phoneE164, code);
    const expiresAt = new Date(Date.now() + this.config.OTP_TTL_SEC * 1000);

    // Identity-infrastructure table: service-scoped GUC, not a user context.
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'identity', true)`;
      await tx.otpCode.upsert({
        where: { phoneHash },
        create: { phoneHash, codeHash, attempts: 0, expiresAt },
        update: { codeHash, attempts: 0, expiresAt },
      });
    });

    await this.sms.sendOtp(phoneE164, code);
  }

  /** @returns true when the code is valid (and consumes it). */
  async verify(phoneE164: string, code: string): Promise<boolean> {
    const phoneHash = await this.crypto.hashLookup(phoneE164);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'identity', true)`;
      const row = await tx.otpCode.findUnique({ where: { phoneHash } });
      if (!row) return false;

      if (row.expiresAt < new Date()) {
        throw new OtpError('EXPIRED', 'OTP expired. Request a new one.');
      }
      if (row.attempts >= this.config.OTP_MAX_ATTEMPTS) {
        throw new OtpError('TOO_MANY_ATTEMPTS', 'Too many attempts. Request a new OTP.');
      }

      const ok = row.codeHash === this.hashCode(phoneE164, code);
      if (!ok) {
        await tx.otpCode.update({
          where: { phoneHash },
          data: { attempts: row.attempts + 1 },
        });
        return false;
      }

      await tx.otpCode.delete({ where: { phoneHash } }); // single use
      return true;
    });
  }
}
