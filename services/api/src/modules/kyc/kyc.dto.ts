/**
 * KYC DTOs (P2-01). Start is strict; the webhook envelope is strict too, but
 * only carries results — never raw documents (DESIGN.md §10.4).
 */
import { z } from 'zod';

export const startKycSchema = z
  .object({
    type: z.enum(['id', 'id_liveness', 'employment']),
  })
  .strict();
export type StartKycDto = z.infer<typeof startKycSchema>;

export const kycWebhookSchema = z
  .object({
    event_id: z.string().min(1).max(128), // idempotency key
    provider_ref: z.string().min(1).max(128),
    result: z.enum(['pass', 'fail', 'error']),
    age: z.number().int().min(0).max(150).optional(),
    name_match: z.boolean().optional(),
    masked_id: z.string().min(1).max(64).optional(),
    score: z.number().min(0).max(100).optional(),
    failure_reason: z.string().max(200).optional(),
  })
  .strict();
export type KycWebhookDto = z.infer<typeof kycWebhookSchema>;
