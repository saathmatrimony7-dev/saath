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
import { MatchingModule } from './modules/matching/matching.module';
import { ScreeningModule } from './modules/screening/screening.module';
import { InteractionsModule } from './modules/interactions/interactions.module';
import { FamilyModule } from './modules/family/family.module';
import { AdminModule } from './modules/admin/admin.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { BillingModule } from './modules/billing/billing.module';
import { CoordinatorModule } from './modules/coordinator/coordinator.module';
import { PrivacyModule } from './modules/privacy/privacy.module';

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
    MatchingModule,
    ScreeningModule,
    InteractionsModule,
    FamilyModule,
    AdminModule,
    NotificationsModule,
    BillingModule,
    MessagingModule,
    CoordinatorModule,
    PrivacyModule,
  ],
  controllers: [HealthController, MeController],
})
export class AppModule {}
