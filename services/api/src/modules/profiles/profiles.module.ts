import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../../prisma/prisma.module';
import {
  DealbreakersController,
  DisclosureController,
  MeProfileController,
  PreferencesController,
  PublicProfilesController,
} from './profiles.controller';
import { ProfilesService } from './profiles.service';

@Module({
  imports: [IdentityModule, PrismaModule],
  controllers: [
    MeProfileController,
    PreferencesController,
    DealbreakersController,
    DisclosureController,
    PublicProfilesController,
  ],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
