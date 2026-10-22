/**
 * Redaction primitives for Saath logging (AGENTS.md rule 8, DESIGN.md §12.4).
 *
 * Two layers, both applied to every log line:
 *  1. Key-based: sensitive field NAMES are replaced with [REDACTED] wherever
 *     they appear in a logged object (any depth, arrays included).
 *  2. Pattern-based: string VALUES are scrubbed for phone numbers, emails and
 *     JWTs — defence in depth for PII smuggled into free-text fields.
 *
 * Rule of thumb: when in doubt, redact. False positives in logs are fine;
 * leaked PII is not.
 */

export const REDACTED = '[REDACTED]';

/** Field names whose VALUES are always redacted (case-insensitive, exact). */
const SENSITIVE_KEYS = new Set([
  'phone',
  'phone_e164',
  'phone_e164_hash',
  'email',
  'otp',
  'otp_code',
  'otpcode',
  'code', // OTP verify payloads
  'token',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'refresh_token_hash',
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'secret',
  'api_key',
  'apikey',
  'body', // message bodies (DESIGN.md §12.4)
  'message_body',
  'content',
  'details_enc',
  'comment_enc',
  'raw_ref_s3',
  'aadhaar',
  'pan',
]);

/** Any key ENDING in these suffixes is also redacted (covers *_enc, *_hash… wait: *_hash lookups are HMACs — safe to keep for debugging, so only *_enc). */
const SENSITIVE_SUFFIXES = ['_enc'];

const isSensitiveKey = (key: string): boolean => {
  const k = key.toLowerCase();
  return SENSITIVE_KEYS.has(k) || SENSITIVE_SUFFIXES.some((s) => k.endsWith(s));
};

/** Value patterns scrubbed inside any string. */
const SCRUB_PATTERNS: RegExp[] = [
  // JWT (header.payload.signature, all base64url)
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  // Bearer tokens
  /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi,
  // Email addresses
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  // Phone numbers: optional +, 10–15 digits allowing spaces/dashes (E.164-ish)
  /\+?[0-9][0-9\s-]{8,14}[0-9]/g,
];

export function scrubString(value: string): string {
  let out = value;
  for (const re of SCRUB_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  return out;
}

const MAX_DEPTH = 8;

/** Deep-redact an arbitrary logged value. Returns a sanitized copy. */
export function deepRedact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => deepRedact(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? REDACTED : deepRedact(v, depth + 1);
    }
    return out;
  }
  return value;
}
