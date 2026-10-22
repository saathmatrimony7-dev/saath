import { z } from 'zod';

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
  })
  .strict();

export type LlmCompleteDto = z.infer<typeof llmCompleteSchema>;
