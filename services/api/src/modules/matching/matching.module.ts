import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { ServiceTokenGuard } from '../llm-gateway/service-token.guard';
import { MatchingService } from './matching.service';
import { MatchingInternalController } from './matching.controller';

@Module({
  imports: [IdentityModule, PrismaModule, ProfilesModule],
  controllers: [MatchingInternalController],
  providers: [MatchingService, ServiceTokenGuard],
  exports: [MatchingService],
})
export class MatchingModule {}
