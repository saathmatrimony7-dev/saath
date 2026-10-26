/**
 * A6 screening tools (P3-05, DESIGN.md §6.1 A6 + §7). Agent-token guarded;
 * both tools are restricted to the A6 broker agent name on top of the
 * per-token tool allow-list. The broker is neutral — no user binding exists
 * in the token, so the pair-scoped binding is enforced structurally instead:
 * snapshots are redacted views (no free text, no ids beyond the uuid), the
 * verdict write is hash-bound to freshly built snapshots, and neither party
 * can ever read screening_results directly (service-context-only RLS).
 *
 *   POST /internal/tools/get_preference_snapshot
 *   POST /internal/tools/write_screening_result
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
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AgentTokenGuard, AGENT_CLAIMS_KEY, ToolName } from '../llm-gateway/agent-token.guard';
import type { ScopedTokenClaims } from '../llm-gateway/agent-token';
import {
  getPreferenceSnapshotSchema,
  writeScreeningResultSchema,
} from './screening.dto';
import { ScreeningService } from './screening.service';
import { A6_BROKER_AGENT } from './tokens';

type AuthedRequest = Request & { [AGENT_CLAIMS_KEY]?: ScopedTokenClaims };

@Controller('internal/tools')
@UseGuards(AgentTokenGuard)
export class ScreeningToolsController {
  constructor(@Inject(ScreeningService) private readonly screening: ScreeningService) {}

  /** These tools serve the neutral broker; only A6 may call them. */
  private assertBroker(req: AuthedRequest): void {
    const claims = req[AGENT_CLAIMS_KEY];
    if (!claims || claims.agent !== A6_BROKER_AGENT) {
      throw new ForbiddenException(`tool restricted to ${A6_BROKER_AGENT}`);
    }
  }

  /** Redacted enums + normalised stances for one side of a pair (§7.2/§7.4.1). */
  @Post('get_preference_snapshot')
  @HttpCode(HttpStatus.OK)
  @ToolName('get_preference_snapshot')
  getPreferenceSnapshot(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(getPreferenceSnapshotSchema)) body: { userId: string },
  ) {
    this.assertBroker(req);
    return this.screening.getPreferenceSnapshot(body.userId);
  }

  /** Stage 1 short-circuit or Stage 3 verdict; hash-bound + cache upsert. */
  @Post('write_screening_result')
  @HttpCode(HttpStatus.OK)
  @ToolName('write_screening_result')
  writeScreeningResult(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(writeScreeningResultSchema))
    body: z.infer<typeof writeScreeningResultSchema>,
  ) {
    this.assertBroker(req);
    return this.screening.writeResult(body);
  }
}
