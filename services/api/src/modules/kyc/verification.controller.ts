/**
 * Verification status endpoint (P2-02, DESIGN.md §19 exit criterion 1).
 *   GET /v1/me/verification → { status, tier, ageVerified, canContact, reasons }
 * `canContact` is false for tier 0, unverified age, or blocked accounts —
 * the P4 messaging path enforces the same rule via KycService.assertCanContact.
 */
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../identity/guards';
import { KycService } from './kyc.service';

@Controller('me/verification')
@UseGuards(AuthGuard)
export class VerificationController {
  constructor(@Inject(KycService) private readonly kyc: KycService) {}

  @Get()
  status(@CurrentUser() userId: string) {
    return this.kyc.verificationStatus(userId);
  }
}
