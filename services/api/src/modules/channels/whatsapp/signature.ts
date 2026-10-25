/**
 * Webhook signature verification (P1-09, DESIGN.md §12 — Meta style):
 *   X-Hub-Signature-256: sha256=<hex HMAC-SHA256(rawBody, app secret)>
 * Constant-time comparison; the secret is never logged.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export function signWhatsAppBody(secret: string, rawBody: Buffer | string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

export function verifyWhatsAppSignature(secret: string, rawBody: Buffer, header: string): boolean {
  const expected = Buffer.from(signWhatsAppBody(secret, rawBody));
  const presented = Buffer.from(header.trim());
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}
