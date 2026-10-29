/**
 * A8 coordinator tool endpoints (P4-09, DESIGN.md §6.1 A8):
 *   POST /internal/tools/propose_slots
 *   POST /internal/tools/send_nudge
 *   POST /internal/tools/record_meeting_feedback
 * The guard verifies the scoped agent token AND the tool allow-list; this
 * controller additionally pins the agent to A8 and binds every call to the
 * token's acting_for_user_id (a token minted for user A can never act for
 * user B). A8's contract: suggestions land on its OWN user only — it can
 * never message, nudge or notify the other participant.
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
import { MessagingService } from '../messaging/messaging.service';
import { A8_COORDINATOR_AGENT } from './tokens';

const proposeSlotsSchema = z
  .object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    slots: z.array(z.string().max(40)).min(1).max(5),
  })
  .strict();

const sendNudgeSchema = z
  .object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
  })
  .strict();

const recordFeedbackSchema = z
  .object({
    userId: z.string().uuid(),
    conversationId: z.string().uuid(),
    outcome: z.enum(['went_well', 'neutral', 'did_not_meet', 'not_a_match']),
    notes: z.string().max(1000).optional(),
  })
  .strict();

type AuthedRequest = Request & { [AGENT_CLAIMS_KEY]?: ScopedTokenClaims };

@Controller('internal/tools')
@UseGuards(AgentTokenGuard)
export class CoordinatorToolsController {
  constructor(@Inject(MessagingService) private readonly messaging: MessagingService) {}

  private assertAgentAndBinding(req: AuthedRequest, userId: string): void {
    const claims = req[AGENT_CLAIMS_KEY];
    if (!claims || claims.agent !== A8_COORDINATOR_AGENT) {
      throw new ForbiddenException(`tool restricted to ${A8_COORDINATOR_AGENT}`);
    }
    if (claims.acting_for_user_id !== userId) {
      throw new ForbiddenException('token not bound to this user');
    }
  }

  @Post('propose_slots')
  @HttpCode(HttpStatus.OK)
  @ToolName('propose_slots')
  proposeSlots(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(proposeSlotsSchema)) body: z.infer<typeof proposeSlotsSchema>,
  ) {
    this.assertAgentAndBinding(req, body.userId);
    return this.messaging.proposeSlots(body.userId, body.conversationId, body.slots);
  }

  @Post('send_nudge')
  @HttpCode(HttpStatus.OK)
  @ToolName('send_nudge')
  sendNudge(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(sendNudgeSchema)) body: z.infer<typeof sendNudgeSchema>,
  ) {
    this.assertAgentAndBinding(req, body.userId);
    return this.messaging.sendNudge(body.userId, body.conversationId);
  }

  @Post('record_meeting_feedback')
  @HttpCode(HttpStatus.OK)
  @ToolName('record_meeting_feedback')
  recordMeetingFeedback(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(recordFeedbackSchema)) body: z.infer<typeof recordFeedbackSchema>,
  ) {
    this.assertAgentAndBinding(req, body.userId);
    return this.messaging.recordMeetingFeedback(
      body.userId,
      body.conversationId,
      body.outcome,
      body.notes,
    );
  }
}
