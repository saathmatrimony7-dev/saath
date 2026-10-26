import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { AgentTokenGuard } from '../llm-gateway/agent-token.guard';
import { ServiceTokenGuard } from '../llm-gateway/service-token.guard';
import { ScreeningService } from './screening.service';
import { ScreeningToolsController } from './screening-tools.controller';
import { ScreeningInternalController } from './screening-internal.controller';

@Module({
  imports: [IdentityModule, PrismaModule],
  controllers: [ScreeningToolsController, ScreeningInternalController],
  providers: [ScreeningService, AgentTokenGuard, ServiceTokenGuard],
  exports: [ScreeningService],
})
export class ScreeningModule {}
