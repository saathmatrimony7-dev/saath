/**
 * Internal screening endpoints (P3-05). Service-token guarded; consumed by
 * the A6 broker engine in the agents service (and later the A4 matchmaker).
 *
 *   POST /internal/screening/find-cached — pair verdict cache lookup
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ServiceTokenGuard } from '../llm-gateway/service-token.guard';
import { findCachedSchema } from './screening.dto';
import { ScreeningService } from './screening.service';

@Controller('internal/screening')
@UseGuards(ServiceTokenGuard)
export class ScreeningInternalController {
  constructor(@Inject(ScreeningService) private readonly screening: ScreeningService) {}

  /** Cache lookup per pair + preference versions (§7.4.5). */
  @Post('find-cached')
  @HttpCode(HttpStatus.OK)
  findCached(
    @Body(new ZodValidationPipe(findCachedSchema))
    body: z.infer<typeof findCachedSchema>,
  ) {
    return this.screening.findCached(body.aUserId, body.bUserId);
  }
}
