/**
 * LLM Gateway service (DESIGN.md §6.0, rule 4).
 *
 * Every in-app LLM call flows through here:
 *   redact (PII scrub before transport) → budget check → route (tier → model
 *   from config) → transport → audit row in llm_calls (tokens, redaction flag).
 *
 * Runtime provider: Anthropic Claude API only. Model names come from config
 * (LLM_MODEL_SMALL/MID/LARGE), never hard-coded (rule 13).
 */
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createLogger, scrubString } from '@saath/logger';
import type { AppConfig } from '../../config';
import { APP_CONFIG } from '../identity/tokens';
import { PrismaService } from '../../prisma/prisma.service';
import { BudgetExceededError, type BudgetStore } from './budget';
import type { LlmTransport, LlmResponse } from './transports';

const logger = createLogger('llm-gateway');

export type ModelTier = 'small' | 'mid' | 'large';

export interface GatewayRequest {
  agent: string; // e.g. "A1-onboarding"
  userId?: string; // acting_for_user_id — budget + audit scope
  plan?: 'free' | 'paid';
  tier: ModelTier;
  system?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens?: number;
}

export interface GatewayResponse extends LlmResponse {
  traceId: string;
}

const DAY_SEC = 86_400;

@Injectable()
export class LlmGatewayService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject('LLM_TRANSPORT') private readonly transport: LlmTransport,
    @Inject('LLM_BUDGET_STORE') private readonly budgets: BudgetStore,
  ) {}

  private modelFor(tier: ModelTier): string {
    switch (tier) {
      case 'small':
        return this.config.LLM_MODEL_SMALL;
      case 'mid':
        return this.config.LLM_MODEL_MID;
      case 'large':
        return this.config.LLM_MODEL_LARGE;
    }
  }

  async complete(req: GatewayRequest): Promise<GatewayResponse> {
    const model = this.modelFor(req.tier);

    // 1. Redact PII before anything leaves the process (§10.2, §12.6).
    const system = req.system ? scrubString(req.system) : undefined;
    const messages = req.messages.map((m) => ({ ...m, content: scrubString(m.content) }));

    // 2. Budgets: per-user daily + global circuit breaker.
    const estimated = messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0);
    if (req.userId) {
      const cap =
        req.plan === 'paid'
          ? this.config.LLM_DAILY_TOKEN_BUDGET_PAID
          : this.config.LLM_DAILY_TOKEN_BUDGET_FREE;
      const used = await this.budgets.get(`llm:user:${req.userId}`);
      if (used + estimated > cap) throw new BudgetExceededError('user');
    }
    const globalUsed = await this.budgets.get('llm:global');
    if (globalUsed + estimated > this.config.LLM_GLOBAL_CIRCUIT_BREAKER_TOKENS) {
      throw new BudgetExceededError('global');
    }

    // 3. Route + call.
    let res: LlmResponse;
    try {
      res = await this.transport.complete({
        model,
        ...(system !== undefined ? { system } : {}),
        messages,
        maxTokens: req.maxTokens ?? 1024,
      });
    } catch {
      logger.error({ agent: req.agent, model }, 'llm call failed');
      throw new ServiceUnavailableException('llm unavailable');
    }

    // 4. Record actual usage + audit row (RLS: llm-gateway service context).
    const total = res.inputTokens + res.outputTokens;
    if (req.userId) await this.budgets.add(`llm:user:${req.userId}`, total, DAY_SEC);
    await this.budgets.add('llm:global', total, DAY_SEC);

    const traceId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'llm-gateway', true)`;
      await tx.llmCall.create({
        data: {
          id: traceId,
          agent: req.agent,
          userId: req.userId ?? null,
          model: res.model,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
          costPaise: 0, // pricing config lands with billing (P4)
          traceId,
          redactionApplied: true,
        },
      });
    });
    logger.info({ agent: req.agent, model: res.model, total, traceId }, 'llm call completed');

    return { ...res, traceId };
  }
}
