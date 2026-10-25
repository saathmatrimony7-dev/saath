/**
 * Onboarding endpoints (P1-06, DESIGN.md A12):
 *   POST /v1/onboarding/sessions                 — start/resume (CSRF)
 *   POST /v1/onboarding/sessions/:id/messages    — one turn, SSE reply (CSRF)
 *   POST /v1/onboarding/confirm                  — profile goes live ONLY here (CSRF)
 *   GET  /v1/onboarding/sessions/:id             — transcript (for the review page)
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthGuard, CsrfGuard, CurrentUser } from '../identity/guards';
import { OnboardingService } from './onboarding.service';
import {
  confirmSessionSchema,
  createSessionSchema,
  postMessageSchema,
  type ConfirmSessionDto,
  type CreateSessionDto,
  type PostMessageDto,
} from './onboarding.dto';

@Controller('onboarding')
@UseGuards(AuthGuard)
export class OnboardingController {
  constructor(@Inject(OnboardingService) private readonly onboarding: OnboardingService) {}

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  start(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(createSessionSchema)) body: CreateSessionDto,
  ) {
    return this.onboarding.start(userId, body);
  }

  @Post('sessions/:id/messages')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  async message(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) sessionId: string,
    @Body(new ZodValidationPipe(postMessageSchema)) body: PostMessageDto,
    @Res() res: Response, // SSE byte stream — full takeover
  ): Promise<void> {
    const result = await this.onboarding.takeTurn(userId, sessionId, body);
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache');
    res.flushHeaders?.();
    for (const word of result.replyText.split(' ')) {
      res.write(`data: ${JSON.stringify({ type: 'delta', delta: word + ' ' })}\n\n`);
    }
    res.write(
      `data: ${JSON.stringify({ type: 'done', status: result.status, turnCount: result.turnCount, reply: result.replyText })}\n\n`,
    );
    res.end();
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  confirm(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(confirmSessionSchema)) body: ConfirmSessionDto,
  ) {
    return this.onboarding.confirm(userId, body);
  }

  @Get('sessions')
  latest(@CurrentUser() userId: string) {
    return this.onboarding.latest(userId).then((session) => {
      if (!session) throw new NotFoundException('no onboarding session');
      return { sessionId: session.id, status: session.status };
    });
  }

  @Get('sessions/:id')
  transcript(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) sessionId: string) {
    return this.onboarding.transcript(userId, sessionId);
  }
}
