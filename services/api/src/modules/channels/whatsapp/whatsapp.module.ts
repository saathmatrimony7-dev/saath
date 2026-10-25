import { Module } from '@nestjs/common';
import type { AppConfig } from '../../../config';
import { PrismaModule } from '../../../prisma/prisma.module';
import { IdentityModule } from '../../identity/identity.module';
import { ConsentModule } from '../../consent/consent.module';
import { OnboardingModule } from '../../onboarding/onboarding.module';
import { APP_CONFIG } from '../../identity/tokens';
import type { ChannelAdapter } from '../channel.types';
import { MockWhatsAppAdapter, MetaWhatsAppAdapter } from './adapter';
import { WHATSAPP_ADAPTER } from './tokens';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';

@Module({
  imports: [IdentityModule, PrismaModule, ConsentModule, OnboardingModule],
  controllers: [WhatsAppController],
  providers: [
    {
      provide: WHATSAPP_ADAPTER,
      useFactory: (config: AppConfig): ChannelAdapter =>
        config.WHATSAPP_PROVIDER === 'meta'
          ? new MetaWhatsAppAdapter(
              config.WHATSAPP_PHONE_NUMBER_ID ?? '',
              config.WHATSAPP_ACCESS_TOKEN ?? '',
            )
          : new MockWhatsAppAdapter(),
      inject: [APP_CONFIG],
    },
    WhatsAppService,
  ],
  exports: [WHATSAPP_ADAPTER],
})
export class WhatsAppModule {}
