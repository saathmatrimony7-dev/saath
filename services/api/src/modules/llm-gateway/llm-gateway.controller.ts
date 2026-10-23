import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { llmCompleteSchema, llmStreamSchema, type LlmCompleteDto } from './llm-gateway.dto';
import { LlmGatewayService } from './llm-gateway.service';
import { BudgetExceededError } from './budget';
import { ServiceTokenGuard } from './service-token.guard';

/** Internal-only surface for agents/workers. Never exposed publicly (WAF/ALB
 * rules restrict /internal/*; this guard is the second layer). */
@Controller('internal/llm')
@UseGuards(ServiceTokenGuard)
export class LlmGatewayController {
  constructor(@Inject(LlmGatewayService) private readonly gateway: LlmGatewayService) {}

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  async complete(@Body(new ZodValidationPipe(llmCompleteSchema)) body: LlmCompleteDto) {
    try {
      return await this.gateway.complete(body);
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        throw new ServiceUnavailableException(err.message);
      }
      throw err;
    }
  }

  /**
   * SSE streaming (P1-05): proxies transport deltas as `data:` events and
   * closes with a done frame carrying traceId + full text. Plain @Post with
   * full @Res takeover (the body is a byte stream, not JSON).
   */
  @Post('stream')
  @HttpCode(HttpStatus.OK)
  async stream(
    @Body(new ZodValidationPipe(llmStreamSchema)) body: LlmCompleteDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('connection', 'keep-alive');
    res.flushHeaders?.();
    try {
      for await (const event of this.gateway.stream(body)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err) {
      const message = err instanceof BudgetExceededError ? err.message : 'llm unavailable';
      res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
    } finally {
      res.end();
    }
  }
}
