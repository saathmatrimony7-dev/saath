/**
 * A4 matchmaker tools (P3-07, DESIGN.md §6.1 A4 + §8). Agent-token guarded;
 * the token must be minted for agent `A4-matchmaker` and bound to exactly
 * the user the tool acts for (§6.0). A4 runs inside the nightly batch and
 * never touches the database — these three tools are its entire surface.
 *
 *   POST /internal/tools/get_candidates        — §8 steps 1-5 (+ shown counts for step 8)
 *   POST /internal/tools/request_screening     — §8 step 6 (delegates to the A6 broker)
 *   POST /internal/tools/publish_daily_matches — §8 step 9 (idempotent replace-set)
 */
import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AgentTokenGuard, AGENT_CLAIMS_KEY, ToolName } from '../llm-gateway/agent-token.guard';
import type { ScopedTokenClaims } from '../llm-gateway/agent-token';
import { MatchingService } from './matching.service';
import { SCREENING_BROKER } from './tokens';
import type { ScreeningBrokerClient } from './screening-broker';
import { A4_MATCHMAKER_AGENT } from './tokens';

type AuthedRequest = Request & { [AGENT_CLAIMS_KEY]?: ScopedTokenClaims };

const getCandidatesSchema = z.object({ userId: z.string().uuid() }).strict();
const requestScreeningSchema = z
  .object({ aUserId: z.string().uuid(), bUserId: z.string().uuid() })
  .strict();
const requestScreeningsSchema = z
  .object({
    aUserId: z.string().uuid(),
    candidateIds: z.array(z.string().uuid()).min(1).max(100),
  })
  .strict();
const publishSchema = z
  .object({
    userId: z.string().uuid(),
    batchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    matches: z
      .array(
        z
          .object({
            candidateId: z.string().uuid(),
            rank: z.number().int().min(1).max(20),
            score: z.number().min(0).max(1),
            // P3-09: A4's per-match explanation, keyed by viewer locale.
            // Plain text only — no HTML (rendered as text, never HTML).
            // partialRecord: keys ⊆ locales, none required (zod4 record
            // with an enum key schema would demand every locale).
            explanation: z
              .partialRecord(
                z.enum(['en', 'hi', 'ta']),
                z
                  .string()
                  .trim()
                  .min(1)
                  .max(280)
                  .refine((s) => !/[<>]/.test(s), 'html is not allowed'),
              )
              .refine((rec) => Object.keys(rec).length >= 1, 'at least one locale')
              .optional(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

@Controller('internal/tools')
@UseGuards(AgentTokenGuard)
export class MatchingToolsController {
  constructor(
    @Inject(MatchingService) private readonly matching: MatchingService,
    @Inject(SCREENING_BROKER) private readonly broker: ScreeningBrokerClient,
  ) {}

  /** A4 acts for exactly one user; every tool body carries that userId. */
  private assertA4(req: AuthedRequest, userId: string): void {
    const claims = req[AGENT_CLAIMS_KEY];
    if (!claims || claims.agent !== A4_MATCHMAKER_AGENT) {
      throw new ForbiddenException(`tool restricted to ${A4_MATCHMAKER_AGENT}`);
    }
    if (claims.acting_for_user_id !== userId) {
      throw new ForbiddenException('token not bound to this user');
    }
  }

  /** §8 steps 1-5 for one user + step-8 input (shown counts for the date). */
  @Post('get_candidates')
  @HttpCode(HttpStatus.OK)
  @ToolName('get_candidates')
  async getCandidates(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(getCandidatesSchema)) body: { userId: string },
  ) {
    this.assertA4(req, body.userId);
    const ranked = await this.matching.rankCandidates(body.userId);
    const today = new Date();
    const shownCounts = await this.matching.shownCountsFor(today);
    return {
      candidates: ranked,
      shownCounts: Object.fromEntries(shownCounts),
      // P3-09: the viewer's locale for explanation generation.
      locale: await this.matching.getUserLocale(body.userId),
    };
  }

  /** §8 step 6: run the §7.3 broker protocol for one candidate pair. */
  @Post('request_screening')
  @HttpCode(HttpStatus.OK)
  @ToolName('request_screening')
  async requestScreening(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(requestScreeningSchema))
    body: { aUserId: string; bUserId: string },
  ) {
    this.assertA4(req, body.aUserId);
    return this.broker.screen(body.aUserId, body.bUserId);
  }

  /**
   * §8 step 6 batched: one call per user instead of N round trips (the
   * nightly batch's hot loop). The broker runs per pair server-side.
   */
  @Post('request_screenings')
  @HttpCode(HttpStatus.OK)
  @ToolName('request_screenings')
  async requestScreenings(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(requestScreeningsSchema))
    body: { aUserId: string; candidateIds: string[] },
  ) {
    this.assertA4(req, body.aUserId);
    const results = [];
    for (const candidateId of body.candidateIds) {
      results.push({ candidateId, ...(await this.broker.screen(body.aUserId, candidateId)) });
    }
    return { results };
  }

  /** §8 step 9: write the user's feed rows (idempotent per batch_date). */
  @Post('publish_daily_matches')
  @HttpCode(HttpStatus.OK)
  @ToolName('publish_daily_matches')
  async publishDailyMatches(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(publishSchema))
    body: z.infer<typeof publishSchema>,
  ) {
    this.assertA4(req, body.userId);
    return this.matching.publishDailyMatches(
      body.userId,
      new Date(`${body.batchDate}T00:00:00Z`),
      body.matches,
    );
  }
}
