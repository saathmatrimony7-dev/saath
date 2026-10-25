/**
 * Generic webhook HMAC signature helpers (Meta-style
 * `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(rawBody, secret)>`).
 * Introduced for WhatsApp (P1-09); reused by the KYC webhook (P2-01).
 * Constant-time comparison; the secret is never logged.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export function signWebhookBody(secret: string, rawBody: Buffer | string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

export function verifyWebhookSignature(secret: string, rawBody: Buffer, header: string): boolean {
  const expected = Buffer.from(signWebhookBody(secret, rawBody));
  const presented = Buffer.from(header.trim());
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}
