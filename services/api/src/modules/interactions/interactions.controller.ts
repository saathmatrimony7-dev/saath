/**
 * Daily-feed interactions (P3-08, DESIGN.md §9 + §19 P3):
 *   POST /v1/matches/:id/like
 *   POST /v1/matches/:id/pass        — optional body { reasonCode }
 *   POST /v1/matches/:id/shortlist
 *
 * `:id` is a daily_matches row id owned by the caller; foreign or missing
 * ids get a 404 (no existence leak — the codebase-wide convention).
 * Authenticated (AuthGuard); mutating routes are CSRF-guarded. The route
 * prefix is `/v1/matches` while the interactions module owns the table;
 * like/pass additionally mark the feed row 'acted' via MatchingService.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthGuard, CsrfGuard, CurrentUser } from '../identity/guards';
import { MatchingService } from '../matching/matching.service';
import {
  InteractionsService,
  PASS_REASON_CODES,
  type InteractionType,
  type PassReasonCode,
  type RecordInteractionResult,
} from './interactions.service';

// `.optional()` tolerates a missing body entirely (empty POST).
const passBodySchema = z
  .object({ reasonCode: z.enum(PASS_REASON_CODES).optional() })
  .strict()
  .optional();

@Controller('matches')
@UseGuards(AuthGuard)
export class InteractionsController {
  constructor(
    @Inject(InteractionsService) private readonly interactions: InteractionsService,
    @Inject(MatchingService) private readonly matching: MatchingService,
  ) {}

  @Post(':id/like')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  like(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) matchId: string,
  ): Promise<RecordInteractionResult & { matchId: string }> {
    return this.act(userId, matchId, 'like');
  }

  @Post(':id/pass')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  pass(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) matchId: string,
    @Body(new ZodValidationPipe(passBodySchema)) body?: { reasonCode?: PassReasonCode },
  ): Promise<RecordInteractionResult & { matchId: string }> {
    return this.act(userId, matchId, 'pass', body?.reasonCode);
  }

  @Post(':id/shortlist')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  shortlist(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) matchId: string,
  ): Promise<RecordInteractionResult & { matchId: string }> {
    return this.act(userId, matchId, 'shortlist');
  }

  private async act(
    userId: string,
    matchId: string,
    type: InteractionType,
    reasonCode?: PassReasonCode,
  ): Promise<RecordInteractionResult & { matchId: string }> {
    const match = await this.matching.getOwnedMatchOr404(userId, matchId);
    const result = await this.interactions.record(userId, match.candidateId, type, reasonCode);
    if (type !== 'shortlist') {
      await this.matching.markActed(userId, matchId);
    }
    return { matchId, ...result };
  }
}
