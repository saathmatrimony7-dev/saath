import { Module } from '@nestjs/common';
import { FieldCrypto, EnvKeyProvider } from '@saath/crypto';
import { loadConfig, type AppConfig } from '../../config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { AuthGuard } from './guards';
import { MemoryRateLimitStore, RateLimiter } from './rate-limit';
import { MockSmsProvider, Msg91SmsProvider, type SmsProvider } from './sms/sms-provider';
import { PrismaService } from '../../prisma/prisma.service';
import { APP_CONFIG, RATE_LIMITER, SMS_PROVIDER } from './tokens';

@Module({
  controllers: [AuthController],
  providers: [
    { provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() },
    {
      provide: FieldCrypto,
      useFactory: () => new FieldCrypto(new EnvKeyProvider()),
    },
    {
      provide: TokenService,
      useFactory: (config: AppConfig) => new TokenService(config),
      inject: [APP_CONFIG],
    },
    {
      provide: SMS_PROVIDER,
      useFactory: (config: AppConfig): SmsProvider =>
        config.OTP_PROVIDER === 'msg91'
          ? new Msg91SmsProvider(config.MSG91_AUTH_KEY ?? '', config.MSG91_SENDER_ID ?? '')
          : new MockSmsProvider(),
      inject: [APP_CONFIG],
    },
    {
      provide: RATE_LIMITER,
      useFactory: () => new RateLimiter(new MemoryRateLimitStore()),
    },
    {
      provide: OtpService,
      useFactory: (
        prisma: PrismaService,
        crypto: FieldCrypto,
        sms: SmsProvider,
        limiter: RateLimiter,
        config: AppConfig,
      ) => new OtpService(prisma, crypto, sms, limiter, config),
      inject: [PrismaService, FieldCrypto, SMS_PROVIDER, RATE_LIMITER, APP_CONFIG],
    },
    {
      provide: AuthService,
      useFactory: (
        prisma: PrismaService,
        crypto: FieldCrypto,
        otp: OtpService,
        tokens: TokenService,
        config: AppConfig,
      ) => new AuthService(prisma, crypto, otp, tokens, config),
      inject: [PrismaService, FieldCrypto, OtpService, TokenService, APP_CONFIG],
    },
    {
      provide: AuthGuard,
      useFactory: (tokens: TokenService) => new AuthGuard(tokens),
      inject: [TokenService],
    },
  ],
  exports: [AuthGuard, TokenService, SMS_PROVIDER, APP_CONFIG],
})
export class IdentityModule {}
