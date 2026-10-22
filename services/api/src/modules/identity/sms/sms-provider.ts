/**
 * SMS providers for OTP delivery (DESIGN.md §4, open decision D-vendor).
 * Vendor assumed MSG91 (owner, P0 Q5); the interface keeps it swappable.
 * The OTP code must never be logged — the logger redacts otp fields anyway.
 */
export interface SmsProvider {
  sendOtp(phoneE164: string, code: string): Promise<void>;
}

/** Dev/test provider: records messages in memory, logs only metadata. */
export class MockSmsProvider implements SmsProvider {
  readonly outbox: { phoneE164: string; code: string }[] = [];

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    this.outbox.push({ phoneE164, code });
  }
}

/** MSG91 flow API. Config-driven; real credentials only in .env.local / Secrets Manager. */
export class Msg91SmsProvider implements SmsProvider {
  constructor(
    private readonly authKey: string,
    private readonly senderId: string,
    private readonly baseUrl = 'https://control.msg91.com/api/v5',
  ) {}

  async sendOtp(phoneE164: string, code: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/otp`, {
      method: 'POST',
      headers: { authkey: this.authKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        template_id: this.senderId,
        mobile: phoneE164.replace('+', ''),
        otp: code,
      }),
    });
    if (!res.ok) {
      // Never include the code or phone in the error.
      throw new Error(`MSG91 send failed with status ${res.status}`);
    }
  }
}
