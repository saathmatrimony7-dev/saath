import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { MessagingModule } from '../messaging/messaging.module';
import { APP_CONFIG } from '../identity/tokens';
import type { AppConfig } from '../../config';
import { CoordinatorToolsController } from './coordinator-tools.controller';
import { CoordinatorController } from './coordinator.controller';
import { createCoordinatorClient } from './coordinator.client';
import { COORDINATOR_CLIENT } from './tokens';

@Module({
  imports: [IdentityModule, PrismaModule, MessagingModule],
  controllers: [CoordinatorToolsController, CoordinatorController],
  providers: [
    {
      provide: COORDINATOR_CLIENT,
      useFactory: (config: AppConfig) => createCoordinatorClient(config),
      inject: [APP_CONFIG],
    },
  ],
  exports: [COORDINATOR_CLIENT],
})
export class CoordinatorModule {}
