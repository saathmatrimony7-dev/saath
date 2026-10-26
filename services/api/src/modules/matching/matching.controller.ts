/**
 * Internal matching endpoints (P3-03). Service-token guarded (DESIGN.md §11:
 * agent↔API calls use scoped tokens); consumed by the A6 screening broker
 * (Stage 1 reuse) and the embedding backfill worker.
 *
 *   POST /internal/matching/check-hard-filters   — broker Stage 1
 *   GET  /internal/matching/stale-embeddings     — delegates to ProfilesService
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ServiceTokenGuard } from '../llm-gateway/service-token.guard';
import { ProfilesService } from '../profiles/profiles.service';
import { MatchingService } from './matching.service';

const checkHardFiltersSchema = z
  .object({ aUserId: z.string().uuid(), bUserId: z.string().uuid() })
  .strict();

const staleEmbeddingsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(10_000).optional(),
  })
  .strict();

@Controller('internal/matching')
@UseGuards(ServiceTokenGuard)
export class MatchingInternalController {
  constructor(
    @Inject(MatchingService) private readonly matching: MatchingService,
    @Inject(ProfilesService) private readonly profiles: ProfilesService,
  ) {}

  /** A6 broker Stage 1: deterministic two-sided hard filter check (no LLM). */
  @Post('check-hard-filters')
  @HttpCode(HttpStatus.OK)
  checkHardFilters(
    @Body(new ZodValidationPipe(checkHardFiltersSchema))
    body: z.infer<typeof checkHardFiltersSchema>,
  ) {
    return this.matching.hardFilterCheck(body.aUserId, body.bUserId);
  }

  /** Embedding backfill (P3-01/P3-02): profiles whose embedding is stale. */
  @Get('stale-embeddings')
  listStaleEmbeddings(
    @Query(new ZodValidationPipe(staleEmbeddingsQuerySchema))
    query: z.infer<typeof staleEmbeddingsQuerySchema>,
  ) {
    return this.profiles.listStaleEmbeddings(query.limit ?? 1000);
  }
}
