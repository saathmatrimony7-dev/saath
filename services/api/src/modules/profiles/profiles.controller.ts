/**
 * Profiles + preferences endpoints (P1-03):
 *   GET/PATCH /v1/me/profile              — profile + community attributes
 *   GET/PUT   /v1/me/preferences          — hard filters + disclosure + soft prefs
 *   GET/PUT   /v1/me/dealbreakers         — replace the whole set
 *   PUT       /v1/me/disclosure-policy    — share level
 *   GET       /v1/profiles/{id}           — owner only until matching ships
 * Authenticated (AuthGuard); mutating routes are CSRF-guarded.
 */
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthGuard, CsrfGuard, CurrentUser } from '../identity/guards';
import { ProfilesService } from './profiles.service';
import {
  patchProfileSchema,
  putDealbreakersSchema,
  putDisclosureSchema,
  putPreferencesSchema,
  type PatchProfileDto,
  type PutDealbreakersDto,
  type PutDisclosureDto,
  type PutPreferencesDto,
} from './profiles.dto';

@Controller('me/profile')
@UseGuards(AuthGuard)
export class MeProfileController {
  constructor(@Inject(ProfilesService) private readonly profiles: ProfilesService) {}

  @Get()
  get(@CurrentUser() userId: string) {
    return this.profiles.getProfile(userId);
  }

  @Patch()
  @UseGuards(CsrfGuard)
  patch(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(patchProfileSchema)) body: PatchProfileDto,
  ) {
    return this.profiles.patchProfile(userId, body);
  }
}

@Controller('me/preferences')
@UseGuards(AuthGuard)
export class PreferencesController {
  constructor(@Inject(ProfilesService) private readonly profiles: ProfilesService) {}

  @Get()
  get(@CurrentUser() userId: string) {
    return this.profiles.getPreferences(userId);
  }

  @Put()
  @UseGuards(CsrfGuard)
  put(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(putPreferencesSchema)) body: PutPreferencesDto,
  ) {
    return this.profiles.putPreferences(userId, body);
  }
}

@Controller('me/dealbreakers')
@UseGuards(AuthGuard)
export class DealbreakersController {
  constructor(@Inject(ProfilesService) private readonly profiles: ProfilesService) {}

  @Get()
  get(@CurrentUser() userId: string) {
    return this.profiles.getDealbreakers(userId);
  }

  @Put()
  @UseGuards(CsrfGuard)
  put(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(putDealbreakersSchema)) body: PutDealbreakersDto,
  ) {
    return this.profiles.putDealbreakers(userId, body);
  }
}

@Controller('me/disclosure-policy')
@UseGuards(AuthGuard)
export class DisclosureController {
  constructor(@Inject(ProfilesService) private readonly profiles: ProfilesService) {}

  @Put()
  @UseGuards(CsrfGuard)
  put(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(putDisclosureSchema)) body: PutDisclosureDto,
  ) {
    return this.profiles.putDisclosurePolicy(userId, body);
  }
}

@Controller('profiles')
@UseGuards(AuthGuard)
export class PublicProfilesController {
  constructor(@Inject(ProfilesService) private readonly profiles: ProfilesService) {}

  @Get(':id')
  get(
    @CurrentUser() requesterId: string,
    @Param('id', ParseUUIDPipe) targetId: string,
  ) {
    return this.profiles.getPublicProfile(requesterId, targetId);
  }
}
