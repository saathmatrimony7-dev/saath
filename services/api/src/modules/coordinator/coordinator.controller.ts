/**
 * A8 coordinator user surface (P4-09, DESIGN.md §6.1 A8):
 *   POST /v1/conversations/:id/suggest — icebreakers/slots for ME only.
 * Lives in the coordinator module (it owns the A8 client) while the route
 * prefix matches the messaging surface.
 */
import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CsrfGuard, CurrentUser } from '../identity/guards';
import { MessagingService } from '../messaging/messaging.service';
import type { CoordinatorClient } from './coordinator.client';
import { COORDINATOR_CLIENT } from './tokens';

@Controller('conversations')
@UseGuards(AuthGuard)
export class CoordinatorController {
  constructor(
    @Inject(MessagingService) private readonly messaging: MessagingService,
    @Inject(COORDINATOR_CLIENT) private readonly coordinator: CoordinatorClient,
  ) {}

  @Post(':id/suggest')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  async suggest(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) conversationId: string) {
    const conv = await this.messaging.getConversation(userId, conversationId);
    return this.coordinator.suggest({
      userId,
      conversationId,
      origin: conv.origin,
      contactShared: conv.contactShared,
      proposedSlots: conv.proposedSlots,
    });
  }
}
