/**
 * KYC user endpoints (P2-01):
 *   POST /v1/me/kyc — start a check (requires kyc consent)
 *   GET  /v1/me/kyc — latest check + current tier
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthGuard, CsrfGuard, CurrentUser } from '../identity/guards';
import { KycService } from './kyc.service';
import { startKycSchema, type StartKycDto } from './kyc.dto';

@Controller('me/kyc')
@UseGuards(AuthGuard)
export class MeKycController {
  constructor(@Inject(KycService) private readonly kyc: KycService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  start(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(startKycSchema)) dto: StartKycDto,
  ) {
    return this.kyc.start(userId, dto);
  }

  @Get()
  async latest(@CurrentUser() userId: string) {
    const latest = await this.kyc.latest(userId);
    if (!latest) throw new NotFoundException('no verification check yet');
    return latest;
  }
}
