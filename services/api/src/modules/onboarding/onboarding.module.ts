import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { APP_CONFIG } from '../identity/tokens';
import type { AppConfig } from '../../config';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { createOnboardingEngine } from './engine';
import { ONBOARDING_ENGINE } from './tokens';

@Module({
  imports: [IdentityModule, PrismaModule, ProfilesModule],
  controllers: [OnboardingController],
  providers: [
    {
      provide: ONBOARDING_ENGINE,
      useFactory: (config: AppConfig) => createOnboardingEngine(config),
      inject: [APP_CONFIG],
    },
    OnboardingService,
  ],
})
export class OnboardingModule {}
