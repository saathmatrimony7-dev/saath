import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { APP_CONFIG } from '../identity/tokens';
import type { AppConfig } from '../../config';
import { BillingController } from './billing.controller';
import { RazorpayWebhookController } from './razorpay-webhook.controller';
import { BillingService } from './billing.service';
import { EntitlementsService } from './entitlements.service';
import { createRazorpayProvider } from './razorpay.provider';
import { RAZORPAY_PROVIDER } from './tokens';

@Module({
  imports: [IdentityModule, PrismaModule, NotificationsModule],
  controllers: [BillingController, RazorpayWebhookController],
  providers: [
    BillingService,
    EntitlementsService,
    {
      provide: RAZORPAY_PROVIDER,
      useFactory: (config: AppConfig) => createRazorpayProvider(config),
      inject: [APP_CONFIG],
    },
  ],
  exports: [BillingService, EntitlementsService],
})
export class BillingModule {}
