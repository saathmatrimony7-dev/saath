/**
 * Messaging surface (P4-01…P4-04 + P4-09, DESIGN.md §11 messaging):
 *   GET  /v1/conversations
 *   POST /v1/conversations                 — open with a candidate (intro credit)
 *   GET  /v1/conversations/:id
 *   GET  /v1/conversations/:id/messages
 *   POST /v1/conversations/:id/messages    — { body, clientRef? }
 *   POST /v1/conversations/:id/share-contact
 *   POST /v1/conversations/:id/calls       — masked call (paywalled)
 *   POST /v1/conversations/:id/calls/:callId/end
 *   GET  /v1/conversations/:id/calls
 * Authenticated (AuthGuard); mutating routes are CSRF-guarded. Foreign or
 * missing ids get a 404 (no existence leak).
 */
import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthGuard, CsrfGuard, CurrentUser } from '../identity/guards';
import { MessagingService } from './messaging.service';

const openConversationSchema = z
  .object({ candidateId: z.string().uuid() })
  .strict();

const sendMessageSchema = z
  .object({
    body: z.string().min(1).max(2000),
    clientRef: z.string().min(1).max(64).optional(),
  })
  .strict();

const endCallSchema = z
  .object({
    status: z.enum(['completed', 'failed', 'declined']),
    durationSec: z.number().int().min(0).max(86_400).optional(),
  })
  .strict();

@Controller('conversations')
@UseGuards(AuthGuard)
export class MessagingController {
  constructor(@Inject(MessagingService) private readonly messaging: MessagingService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.messaging.listConversations(userId);
  }

  @Post()
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  open(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(openConversationSchema)) body: { candidateId: string },
  ) {
    return this.messaging.openIntro(userId, body.candidateId);
  }

  @Get(':id')
  get(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) conversationId: string) {
    return this.messaging.getConversation(userId, conversationId);
  }

  @Get(':id/messages')
  messages(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    return this.messaging.listMessages(userId, conversationId, limit);
  }

  @Post(':id/messages')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  send(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: z.infer<typeof sendMessageSchema>,
  ) {
    return this.messaging.sendMessage(userId, conversationId, body.body, body.clientRef);
  }

  @Post(':id/share-contact')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  shareContact(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) conversationId: string) {
    return this.messaging.shareContact(userId, conversationId);
  }

  @Post(':id/calls')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  startCall(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) conversationId: string) {
    return this.messaging.startCall(userId, conversationId);
  }

  @Post(':id/calls/:callId/end')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  endCall(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Param('callId', ParseUUIDPipe) callId: string,
    @Body(new ZodValidationPipe(endCallSchema)) body: z.infer<typeof endCallSchema>,
  ) {
    return this.messaging.endCall(userId, conversationId, callId, body);
  }

  @Get(':id/calls')
  calls(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) conversationId: string) {
    return this.messaging.listCalls(userId, conversationId);
  }
}
