/**
 * Pre-send contact-mask scanner (P4-02, DESIGN.md §10.2 + §14): chat blocks
 * phone numbers, email addresses, links and social handles until BOTH users
 * opt in to share contacts (conversation.contact_shared_at is set). The
 * scan is deterministic — no LLM on the send path (the async A9 classifier
 * is a separate boundary, and raw bodies still never leave Core for it
 * without redaction per the moderation-agent client).
 */
export const MASK_REASON_CODES = ['PHONE', 'EMAIL', 'URL', 'HANDLE'] as const;
export type MaskReasonCode = (typeof MASK_REASON_CODES)[number];

const PATTERNS: { code: MaskReasonCode; re: RegExp }[] = [
  { code: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { code: 'URL', re: /\b(?:https?:\/\/|www\.)\S+/i },
  // Indian mobile: optional +91 / 0 prefix, 10 digits starting 6-9, optional
  // space/dash between the 5-digit halves ("98765 43210").
  { code: 'PHONE', re: /(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}\b/ },
  // International-style long digit runs with separators ("+1 415 555 0134").
  { code: 'PHONE', re: /\+\d{1,3}[\s-]?\d{3,4}[\s-]?\d{3,4}[\s-]?\d{3,4}\b/ },
  // Platform keywords pointing at a handle/id.
  {
    code: 'HANDLE',
    re: /\b(?:insta|instagram|telegram|snap|snapchat|fb|facebook|signal)\s*[:@]?\s*@?[A-Za-z0-9._]{2,}\b/i,
  },
  // Bare @handle.
  { code: 'HANDLE', re: /@[A-Za-z0-9_][A-Za-z0-9._]{1,29}\b/ },
];

export interface MaskScanResult {
  blocked: boolean;
  reasons: MaskReasonCode[];
}

/** Returns the closed-vocabulary mask reasons found in a message body. */
export function scanForContactDetails(body: string): MaskScanResult {
  const reasons = new Set<MaskReasonCode>();
  for (const { code, re } of PATTERNS) {
    if (re.test(body)) reasons.add(code);
  }
  return { blocked: reasons.size > 0, reasons: [...reasons] };
}
