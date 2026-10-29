/**
 * Family Mode endpoints (P3-10, DESIGN.md §19 + §6 A7):
 *   POST /v1/family/invites           — owner creates an invite (D7 perms)
 *   POST /v1/family/invites/accept    — member binds their account (single-use)
 *   GET  /v1/family/invites           — caller's invites (as owner and/or member)
 *   GET  /v1/family/shortlist         — member sees the owner's gated shortlist
 *   POST /v1/family/feedback          — structured signal (+ encrypted comment)
 *   GET  /v1/family/feedback          — owner (all) / member (own rows)
 *   GET  /v1/family/summary           — A7 digest in the owner's language
 *
 * Authenticated (AuthGuard); mutations are CSRF-guarded. Family members act
 * only through these endpoints — RLS gives them no write path at all.
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
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthGuard, CsrfGuard, CurrentUser } from '../identity/guards';
import { FamilyService } from './family.service';
import {
  acceptInviteSchema,
  createInviteSchema,
  familyFeedbackSchema,
  ownerIdQuerySchema,
  type AcceptInviteDto,
  type CreateInviteDto,
  type FamilyFeedbackDto,
} from './family.dto';

@Controller('family')
@UseGuards(AuthGuard)
export class FamilyController {
  constructor(@Inject(FamilyService) private readonly family: FamilyService) {}

  @Post('invites')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  createInvite(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(createInviteSchema)) body: CreateInviteDto,
  ) {
    return this.family.createInvite(userId, body);
  }

  @Post('invites/accept')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  acceptInvite(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(acceptInviteSchema)) body: AcceptInviteDto,
  ) {
    return this.family.acceptInvite(userId, body);
  }

  @Get('invites')
  listInvites(@CurrentUser() userId: string) {
    return this.family.listFor(userId);
  }

  @Get('shortlist')
  getShortlist(
    @CurrentUser() userId: string,
    @Query(new ZodValidationPipe(ownerIdQuerySchema)) query: { ownerId?: string },
  ) {
    return this.family.getShortlist(userId, query.ownerId);
  }

  @Post('feedback')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  saveFeedback(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(familyFeedbackSchema)) body: FamilyFeedbackDto,
  ) {
    return this.family.saveFeedback(userId, body);
  }

  @Get('feedback')
  listFeedback(
    @CurrentUser() userId: string,
    @Query(new ZodValidationPipe(ownerIdQuerySchema)) query: { ownerId?: string },
  ) {
    return this.family.listFeedback(userId, query.ownerId);
  }

  @Get('summary')
  getSummary(
    @CurrentUser() userId: string,
    @Query(new ZodValidationPipe(ownerIdQuerySchema)) query: { ownerId?: string },
  ) {
    return this.family.getSummary(userId, query.ownerId);
  }
}
