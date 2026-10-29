import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { PhotosModule } from '../photos/photos.module';
import { AgentTokenGuard } from '../llm-gateway/agent-token.guard';
import { ServiceTokenGuard } from '../llm-gateway/service-token.guard';
import { APP_CONFIG } from '../identity/tokens';
import type { AppConfig } from '../../config';
import { MatchingService } from './matching.service';
import { MatchingInternalController } from './matching.controller';
import { MatchingToolsController } from './matching-tools.controller';
import { MatchesController } from './matches.controller';
import { createScreeningBroker } from './screening-broker';
import { MATCHING_SERVICE, SCREENING_BROKER } from './tokens';

@Module({
  imports: [IdentityModule, PrismaModule, ProfilesModule, PhotosModule],
  controllers: [MatchingInternalController, MatchingToolsController, MatchesController],
  providers: [
    { provide: MATCHING_SERVICE, useClass: MatchingService },
    {
      provide: SCREENING_BROKER,
      useFactory: (config: AppConfig) => createScreeningBroker(config),
      inject: [APP_CONFIG],
    },
    MatchingService,
    AgentTokenGuard,
    ServiceTokenGuard,
  ],
  exports: [MatchingService],
})
export class MatchingModule {}
