/**
 * WhatsApp webhook payload (P1-09). Shape follows Meta Cloud API callbacks;
 * the mock adapter emits the same envelope so tests exercise the real path.
 * Strict on the structural envelope; message items are a vendor extension
 * point (Meta adds per-type fields we do not consume) — the service only
 * processes items with type === 'text'.
 */
import { z } from 'zod';

const textMessageSchema = z.looseObject({
  from: z.string().min(6).max(16), // E.164 without '+'
  id: z.string().min(1).max(128), // wamid — doubles as the idempotency key
  type: z.string(),
  text: z
    .object({ body: z.string().min(1).max(5000) })
    .strict()
    .optional(),
});

const valueSchema = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: z.object({ phone_number_id: z.string() }).strict(),
  contacts: z
    .array(
      z.object({ wa_id: z.string(), profile: z.object({ name: z.string() }).strict() }).strict(),
    )
    .optional(),
  messages: z.array(textMessageSchema).optional(),
});

const changeSchema = z.object({
  field: z.string(), // 'messages' for inbound; other fields are ignored
  value: valueSchema,
});

const entrySchema = z.object({
  id: z.string(),
  changes: z.array(changeSchema).min(1),
});

export const whatsappWebhookSchema = z
  .object({
    object: z.string(),
    entry: z.array(entrySchema).min(1),
  })
  .strict();

export type WhatsAppWebhookDto = z.infer<typeof whatsappWebhookSchema>;
export type WhatsAppTextMessage = z.infer<typeof textMessageSchema>;
