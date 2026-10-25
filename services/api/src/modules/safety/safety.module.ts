import { Module } from '@nestjs/common';
import type { AppConfig } from '../../config';
import { PrismaModule } from '../../prisma/prisma.module';
import { IdentityModule } from '../identity/identity.module';
import { APP_CONFIG } from '../identity/tokens';
import { SafetyService } from './safety.service';
import { RiskScoringService } from './risk-scoring.service';
import { createModerationAgent } from './moderation-agent';
import { MODERATION_AGENT } from './moderation-agent.tokens';
import { UsersSafetyController, MeBlocksController, MeRiskController } from './safety.controller';

@Module({
  imports: [IdentityModule, PrismaModule],
  controllers: [UsersSafetyController, MeBlocksController, MeRiskController],
  providers: [
    SafetyService,
    RiskScoringService,
    {
      provide: MODERATION_AGENT,
      useFactory: (config: AppConfig) => createModerationAgent(config),
      inject: [APP_CONFIG],
    },
  ],
  exports: [SafetyService, RiskScoringService, MODERATION_AGENT],
})
export class SafetyModule {}
