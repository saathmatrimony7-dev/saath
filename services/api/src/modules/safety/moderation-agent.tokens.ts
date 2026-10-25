/** Injection token for the A9 moderation agent client (ADR-0004). */
export const MODERATION_AGENT = 'MODERATION_AGENT';

export type ModerationLabel =
  | 'safe'
  | 'money_request'
  | 'off_platform_pressure'
  | 'scam_script'
  | 'harassment'
  | 'sexual_content';

export interface ModerationVerdict {
  label: ModerationLabel;
  confidence: number;
}
