import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IdentityModule } from '../identity/identity.module';
import { SafetyService } from './safety.service';
import { RiskScoringService } from './risk-scoring.service';
import { UsersSafetyController, MeBlocksController, MeRiskController } from './safety.controller';

@Module({
  imports: [IdentityModule, PrismaModule],
  controllers: [UsersSafetyController, MeBlocksController, MeRiskController],
  providers: [SafetyService, RiskScoringService],
  exports: [SafetyService, RiskScoringService],
})
export class SafetyModule {}
