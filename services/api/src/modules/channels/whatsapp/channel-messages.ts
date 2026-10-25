/**
 * Channel-owned chat strings (P1-09). The interview itself is engine output
 * (already localized, already [AI]-labelled); these are transactional channel
 * messages (opt-out ack, confirm nudge) so they stay in the channel module.
 * Language follows the inbound message script where detectable (this is UX
 * language detection, never community inference — rule 10).
 */
export type ChannelLocale = 'en' | 'hi' | 'ta';

const OPT_OUT_ACK: Record<ChannelLocale, string> = {
  en: 'You have unsubscribed from Saath messages on WhatsApp. You can re-enable them anytime in the app settings.',
  hi: 'आपने साथ के WhatsApp संदेश बंद कर दिए हैं। आप ऐप सेटिंग में कभी भी इन्हें फिर चालू कर सकते हैं।',
  ta: 'சாத் WhatsApp செய்திகளை நீங்கள் நிறுத்திவிட்டீர்கள். ஆப் அமைப்புகளில் மீண்டும் இயக்கலாம்.',
};

const CONFIRM_NUDGE: Record<ChannelLocale, string> = {
  en: 'Your profile draft is ready. Please review and confirm it in the Saath app to make it live.',
  hi: 'आपका प्रोफ़ाइल मसौदा तैयार है। इसे लाइव करने के लिए कृपया साथ ऐप में जाकर समीक्षा करके पुष्टि करें।',
  ta: 'உங்கள் சுயவிவர வரைவு தயார். நேரடியாக்க சாத் ஆப்பில் மதிப்பாய்வு செய்து உறுதிப்படுத்தவும்.',
};

export function optOutAck(locale: ChannelLocale): string {
  return OPT_OUT_ACK[locale];
}

export function confirmNudge(locale: ChannelLocale): string {
  return CONFIRM_NUDGE[locale];
}

/** UI language from the inbound script (Devanagari/Tamil), else the account locale. */
export function detectLocale(text: string, fallback: string): ChannelLocale {
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
  return fallback === 'hi' || fallback === 'ta' ? fallback : 'en';
}
