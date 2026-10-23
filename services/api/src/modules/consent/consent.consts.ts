/**
 * Consent purposes (P1-02, DESIGN.md A6). The DB stores free text; the service
 * layer restricts to this list so the ledger stays analysable.
 */
export const CONSENT_PURPOSES = [
  'matchmaking',
  'agent_screening',
  'family_mode',
  'whatsapp',
  'kyc',
  'marketing',
] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export function isConsentPurpose(v: string): v is ConsentPurpose {
  return (CONSENT_PURPOSES as readonly string[]).includes(v);
}

/** Recorded automatically at OTP signup (notice text shown pre-verification). */
export const SIGNUP_PURPOSES: readonly ConsentPurpose[] = ['matchmaking', 'agent_screening'];

export const CONSENT_CHANNELS = ['otp_signup', 'app', 'web', 'whatsapp'] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];
