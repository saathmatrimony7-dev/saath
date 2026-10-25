import { Module } from '@nestjs/common';
import type { AppConfig } from '../../config';
import { PrismaModule } from '../../prisma/prisma.module';
import { IdentityModule } from '../identity/identity.module';
import { ConsentModule } from '../consent/consent.module';
import { APP_CONFIG } from '../identity/tokens';
import { IdfyKycProvider, MockKycProvider, type KycProvider } from './provider';
import { KYC_PROVIDER_TOKEN } from './tokens';
import { KycService } from './kyc.service';
import { MeKycController } from './kyc.controller';
import { KycWebhookController } from './kyc-webhook.controller';

@Module({
  imports: [IdentityModule, PrismaModule, ConsentModule],
  controllers: [MeKycController, KycWebhookController],
  providers: [
    {
      provide: KYC_PROVIDER_TOKEN,
      useFactory: (config: AppConfig): KycProvider =>
        config.KYC_PROVIDER === 'idfy'
          ? new IdfyKycProvider(config.IDFY_ACCOUNT_ID ?? '', config.IDFY_API_KEY ?? '')
          : new MockKycProvider(),
      inject: [APP_CONFIG],
    },
    KycService,
  ],
  exports: [KycService],
})
export class KycModule {}
