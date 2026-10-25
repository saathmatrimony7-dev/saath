/**
 * Channel abstraction (P1-09, DESIGN.md §12). A ChannelAdapter is an outbound
 * messaging transport. WhatsApp is the first implementation (mock now, Meta
 * Cloud API as a config-only swap later); the interface is the seam the
 * notifications service (templates, quiet hours, per §10.2) will reuse.
 */
export interface ChannelAdapter {
  readonly channel: 'whatsapp';
  /** Send one plain-text message to an E.164 number. Never log the text. */
  sendText(toE164: string, text: string): Promise<void>;
}
