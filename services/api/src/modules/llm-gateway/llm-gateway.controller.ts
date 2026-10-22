import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { llmCompleteSchema, type LlmCompleteDto } from './llm-gateway.dto';
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
}
