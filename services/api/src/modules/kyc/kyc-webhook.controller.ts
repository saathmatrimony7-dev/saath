/**
 * KYC provider webhook (P2-01, DESIGN.md §12):
 *   POST /v1/hooks/kyc — result delivery (HMAC signature verified, idempotent).
 * The raw-body requirement is the same as the WhatsApp webhook: the HMAC
 * covers the exact bytes the provider sent.
 */
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AppConfig } from '../../config';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { verifyWebhookSignature } from '../../common/hmac-signature';
import { APP_CONFIG } from '../identity/tokens';
import { KycService } from './kyc.service';
import { kycWebhookSchema, type KycWebhookDto } from './kyc.dto';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('hooks')
export class KycWebhookController {
  constructor(
    @Inject(KycService) private readonly kyc: KycService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('kyc')
  @HttpCode(200)
  async result(
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() req: RawBodyRequest,
    @Body(new ZodValidationPipe(kycWebhookSchema)) dto: KycWebhookDto,
  ): Promise<{ received: true }> {
    const rawBody = req.rawBody;
    if (
      !rawBody ||
      !signature ||
      !verifyWebhookSignature(this.config.KYC_WEBHOOK_SECRET, rawBody, signature)
    ) {
      throw new UnauthorizedException('invalid webhook signature');
    }
    await this.kyc.handleWebhook(dto);
    return { received: true };
  }
}
