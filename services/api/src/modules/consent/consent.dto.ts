import { z } from 'zod';
import { CONSENT_CHANNELS } from './consent.consts';

/** PUT /v1/me/consents/{purpose} — strict: unknown fields rejected (rule 3). */
export const putConsentSchema = z
  .object({
    granted: z.boolean(),
    channel: z.enum(CONSENT_CHANNELS).default('app'),
  })
  .strict();

export type PutConsentDto = z.infer<typeof putConsentSchema>;
