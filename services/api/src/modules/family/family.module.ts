import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ConsentModule } from '../consent/consent.module';
import { MatchingModule } from '../matching/matching.module';
import { APP_CONFIG } from '../identity/tokens';
import type { AppConfig } from '../../config';
import { FamilyController } from './family.controller';
import { FamilyService } from './family.service';
import { createFamilySummariser } from './summariser';
import { FAMILY_SUMMARISER } from './tokens';

@Module({
  imports: [IdentityModule, PrismaModule, ConsentModule, MatchingModule],
  controllers: [FamilyController],
  providers: [
    FamilyService,
    {
      provide: FAMILY_SUMMARISER,
      useFactory: (config: AppConfig) => createFamilySummariser(config),
      inject: [APP_CONFIG],
    },
  ],
  exports: [FamilyService],
})
export class FamilyModule {}
