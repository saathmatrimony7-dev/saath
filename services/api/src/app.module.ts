import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MeController } from './me.controller';
import { PrismaModule } from './prisma/prisma.module';
import { IdentityModule } from './modules/identity/identity.module';
import { LlmGatewayModule } from './modules/llm-gateway/llm-gateway.module';
import { TaxonomyModule } from './modules/taxonomy/taxonomy.module';
import { ConsentModule } from './modules/consent/consent.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { PhotosModule } from './modules/photos/photos.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { WhatsAppModule } from './modules/channels/whatsapp/whatsapp.module';
import { KycModule } from './modules/kyc/kyc.module';
import { SafetyModule } from './modules/safety/safety.module';

@Module({
  imports: [
    PrismaModule,
    IdentityModule,
    LlmGatewayModule,
    TaxonomyModule,
    ConsentModule,
    ProfilesModule,
    PhotosModule,
    OnboardingModule,
    WhatsAppModule,
    KycModule,
    SafetyModule,
  ],
  controllers: [HealthController, MeController],
})
export class AppModule {}
