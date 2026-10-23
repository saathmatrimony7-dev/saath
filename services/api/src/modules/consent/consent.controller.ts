/**
 * Consent ledger endpoints (P1-02):
 *   GET /v1/me/consents              — current state for every purpose
 *   PUT /v1/me/consents/{purpose}    — append a grant/withdrawal row (CSRF-guarded)
 * Authenticated; rows are scoped to the caller by RLS + service layer.
 */
import { Body, Controller, Get, Inject, Param, Put, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthGuard, CsrfGuard, CurrentUser } from '../identity/guards';
import { ConsentService } from './consent.service';
import { putConsentSchema, type PutConsentDto } from './consent.dto';
import type { ConsentState, RecordedConsent } from './consent.service';

@Controller('me/consents')
@UseGuards(AuthGuard)
export class ConsentController {
  constructor(@Inject(ConsentService) private readonly consents: ConsentService) {}

  @Get()
  list(@CurrentUser() userId: string): Promise<ConsentState[]> {
    return this.consents.latest(userId);
  }

  @Put(':purpose')
  @UseGuards(CsrfGuard)
  update(
    @CurrentUser() userId: string,
    @Param('purpose') purpose: string,
    @Body(new ZodValidationPipe(putConsentSchema)) body: PutConsentDto,
  ): Promise<RecordedConsent> {
    return this.consents.record(userId, purpose, body.granted, body.channel);
  }
}
