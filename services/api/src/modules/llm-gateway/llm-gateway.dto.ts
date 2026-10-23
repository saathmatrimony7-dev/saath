import { z } from 'zod';

export const llmToolSchema = z
  .object({
    name: z.string().min(1).max(64),
    description: z.string().max(1000).optional(),
    input_schema: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const llmCompleteSchema = z
  .object({
    agent: z.string().min(1).max(64),
    userId: z.string().uuid().optional(),
    plan: z.enum(['free', 'paid']).default('free'),
    tier: z.enum(['small', 'mid', 'large']),
    system: z.string().max(20_000).optional(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            content: z.string().min(1).max(50_000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    maxTokens: z.number().int().positive().max(8192).optional(),
    tools: z.array(llmToolSchema).max(20).optional(),
  })
  .strict();

export type LlmCompleteDto = z.infer<typeof llmCompleteSchema>;

/** Stream endpoint accepts the same shape (tools included for tool-use). */
export const llmStreamSchema = llmCompleteSchema;
