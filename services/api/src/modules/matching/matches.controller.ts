/**
 * User-facing daily feed (P3-08): GET /v1/matches/today — the caller's
 * disclosure-gated cards for today, live-gated (blocks / passes /
 * verification / screening verdicts). Authenticated (AuthGuard).
 * (InteractionsController in the interactions module mounts the
 * /v1/matches/:id/like|pass|shortlist POSTs on the same prefix.)
 */
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../identity/guards';
import { MatchingService } from './matching.service';

@Controller('matches')
@UseGuards(AuthGuard)
export class MatchesController {
  constructor(@Inject(MatchingService) private readonly matching: MatchingService) {}

  @Get('today')
  getFeed(@CurrentUser() userId: string) {
    return this.matching.getFeed(userId);
  }
}
