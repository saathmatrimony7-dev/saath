/**
 * WhatsApp adapter implementations (P1-09). Mock = in-memory outbox for
 * tests/dev (refused in production, like the other mock vendors). Meta Cloud
 * API is the real transport — wired but unreachable until credentials exist.
 */
import type { ChannelAdapter } from '../channel.types';

/** Dev/test provider: records outbound messages in memory, logs nothing. */
export class MockWhatsAppAdapter implements ChannelAdapter {
  readonly channel = 'whatsapp' as const;
  readonly outbox: { toE164: string; text: string }[] = [];

  async sendText(toE164: string, text: string): Promise<void> {
    this.outbox.push({ toE164, text });
  }
}

/** Meta WhatsApp Cloud API (Graph API) text messages. */
export class MetaWhatsAppAdapter implements ChannelAdapter {
  readonly channel = 'whatsapp' as const;

  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    private readonly baseUrl = 'https://graph.facebook.com/v21.0',
  ) {}

  async sendText(toE164: string, text: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toE164.replace('+', ''),
        type: 'text',
        text: { preview_url: false, body: text },
      }),
    });
    if (!res.ok) {
      // Never include the recipient or body in the error.
      throw new Error(`WhatsApp Cloud API send failed with status ${res.status}`);
    }
  }
}
