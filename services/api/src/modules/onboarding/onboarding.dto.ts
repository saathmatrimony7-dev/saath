import { z } from 'zod';

export const ONBOARDING_LOCALES = ['en', 'hi', 'ta'] as const;

export const createSessionSchema = z
  .object({
    locale: z.enum(ONBOARDING_LOCALES).default('en'),
  })
  .strict();

export const postMessageSchema = z
  .object({
    text: z.string().min(1).max(5000),
  })
  .strict();

export const confirmSessionSchema = z
  .object({
    sessionId: z.string().uuid(),
    confirmed: z.literal(true),
  })
  .strict();

export type CreateSessionDto = z.infer<typeof createSessionSchema>;
export type PostMessageDto = z.infer<typeof postMessageSchema>;
export type ConfirmSessionDto = z.infer<typeof confirmSessionSchema>;
