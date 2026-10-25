/**
 * WhatsApp webhook endpoints (P1-09, DESIGN.md §12):
 *   GET  /v1/hooks/whatsapp — Meta subscription verification (challenge)
 *   POST /v1/hooks/whatsapp — inbound messages (HMAC signature verified,
 *        idempotent event ids, processed via WhatsAppService)
 * Unauthenticated by nature; the signature IS the authentication.
 */
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AppConfig } from '../../../config';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { APP_CONFIG } from '../../identity/tokens';
import { verifyWhatsAppSignature } from './signature';
import { whatsappWebhookSchema, type WhatsAppWebhookDto } from './whatsapp.dto';
import { WhatsAppService } from './whatsapp.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('hooks')
export class WhatsAppController {
  constructor(
    @Inject(WhatsAppService) private readonly whatsapp: WhatsAppService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Meta webhook subscription handshake (hub.mode/hub.verify_token/hub.challenge). */
  @Get('whatsapp')
  verifySubscription(@Query() query: Record<string, string | undefined>): string {
    if (
      query['hub.mode'] === 'subscribe' &&
      query['hub.verify_token'] === this.config.WHATSAPP_VERIFY_TOKEN
    ) {
      return query['hub.challenge'] ?? '';
    }
    throw new ForbiddenException('webhook verification failed');
  }

  @Post('whatsapp')
  @HttpCode(200)
  async inbound(
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() req: RawBodyRequest,
    @Body(new ZodValidationPipe(whatsappWebhookSchema)) dto: WhatsAppWebhookDto,
  ): Promise<{ received: true }> {
    const rawBody = req.rawBody;
    if (
      !rawBody ||
      !signature ||
      !verifyWhatsAppSignature(this.config.WHATSAPP_WEBHOOK_SECRET, rawBody, signature)
    ) {
      throw new UnauthorizedException('invalid webhook signature');
    }
    await this.whatsapp.handleInbound(dto);
    return { received: true };
  }
}
