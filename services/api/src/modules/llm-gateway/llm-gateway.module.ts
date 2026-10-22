import { Module } from '@nestjs/common';
import type { AppConfig } from '../../config';
import { APP_CONFIG } from '../identity/tokens';
import { LlmGatewayController } from './llm-gateway.controller';
import { LlmGatewayService } from './llm-gateway.service';
import { MemoryBudgetStore } from './budget';
import { AnthropicTransport, MockTransport, type LlmTransport } from './transports';
import { ServiceTokenGuard } from './service-token.guard';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [IdentityModule], // provides APP_CONFIG
  controllers: [LlmGatewayController],
  providers: [
    {
      provide: 'LLM_TRANSPORT',
      useFactory: (config: AppConfig): LlmTransport =>
        config.LLM_GATEWAY_TRANSPORT === 'anthropic'
          ? new AnthropicTransport(config.ANTHROPIC_API_KEY ?? '')
          : new MockTransport(),
      inject: [APP_CONFIG],
    },
    { provide: 'LLM_BUDGET_STORE', useFactory: () => new MemoryBudgetStore() },
    LlmGatewayService,
    ServiceTokenGuard,
  ],
  exports: [LlmGatewayService],
})
export class LlmGatewayModule {}
