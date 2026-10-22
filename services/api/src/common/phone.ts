/** Normalise an Indian phone number to E.164 (+91…). Caller-facing helper; the
 * phone itself is C4 data — only its HMAC hash may appear in logs or lookups. */
export function normalisePhoneE164(input: string): string {
  const digits = input.replace(/[^\d+]/g, '');
  if (/^\+91\d{10}$/.test(digits)) return digits;
  if (/^91\d{10}$/.test(digits)) return `+${digits}`;
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  throw new Error('invalid phone number (expected Indian 10-digit or +91…)');
}
