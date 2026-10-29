import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { SafetyModule } from '../safety/safety.module';
import { BillingModule } from '../billing/billing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { APP_CONFIG } from '../identity/tokens';
import type { AppConfig } from '../../config';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { createCallProvider } from './call-provider';
import { CALL_PROVIDER } from './tokens';

@Module({
  imports: [IdentityModule, PrismaModule, SafetyModule, BillingModule, NotificationsModule],
  controllers: [MessagingController],
  providers: [
    MessagingService,
    {
      provide: CALL_PROVIDER,
      useFactory: (config: AppConfig) => createCallProvider(config),
      inject: [APP_CONFIG],
    },
  ],
  exports: [MessagingService],
})
export class MessagingModule {}
