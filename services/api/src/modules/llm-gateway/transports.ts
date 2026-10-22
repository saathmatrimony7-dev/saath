/**
 * LLM transports. The Anthropic SDK is imported ONLY here (AGENTS.md rule 4:
 * all LLM calls go through the LLM Gateway). scripts/check-llm-isolation.mjs
 * enforces this in CI.
 */
import Anthropic from '@anthropic-ai/sdk';

export interface LlmRequest {
  model: string;
  system?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
}

export interface LlmResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmTransport {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/** Real Claude API transport (Anthropic). Used only when explicitly configured. */
export class AnthropicTransport implements LlmTransport {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const res = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      ...(req.system ? { system: req.system } : {}),
      messages: req.messages,
    });
    const text = res.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return {
      text,
      model: res.model,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    };
  }
}

/** Deterministic mock for dev/CI — no network, no key, no cost. */
export class MockTransport implements LlmTransport {
  readonly calls: LlmRequest[] = [];

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    const inputTokens = req.messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0);
    const text = `[mock:${req.model}] ok`;
    return { text, model: req.model, inputTokens, outputTokens: Math.ceil(text.length / 4) };
  }
}
