/**
 * Onboarding engine behind an interface (P1-06). The real A1 interview state
 * machine lives in the Python agents service (DESIGN.md A6.1); Core drives it
 * over HTTP. The mock is a deterministic scripted engine for tests/dev with
 * the SAME contract (refused in production, like the other mock vendors).
 *
 * Every assistant message the engine produces must be labelled as AI-written
 * (the mock prefixes it; the Python engine's prompt enforces it — P1-06 exit).
 */
import type { AppConfig } from '../../config';

export type SessionStatus = 'in_progress' | 'awaiting_confirm';

export interface TurnInput {
  sessionId: string;
  userId: string;
  locale: string; // en | hi | ta
  turnCount: number;
  userText: string;
  /** Full transcript so the stateless HTTP engine can resume context. */
  history: { role: 'user' | 'assistant'; content: string }[];
}

export interface TurnOutput {
  replyText: string; // already AI-labelled
  status: SessionStatus;
}

export interface OnboardingEngine {
  greeting(locale: string): string;
  takeTurn(input: TurnInput): Promise<TurnOutput>;
}

const AI_LABEL: Record<string, string> = {
  en: '[AI] ',
  hi: '[AI] ',
  ta: '[AI] ',
};

/** Scripted mock: walks fixed topics, ends with a confirm summary. */
export class MockOnboardingEngine implements OnboardingEngine {
  constructor(private readonly maxTurns: number) {}

  greeting(locale: string): string {
    const g: Record<string, string> = {
      en: 'Namaste! I am your Saath onboarding assistant. Shall we begin with a little about you?',
      hi: 'नमस्ते! मैं आपकी साथ ऑनबोर्डिंग सहायक हूँ। क्या हम आपके बारे में थोड़ी बात से शुरुआत करें?',
      ta: 'வணக்கம்! நான் உங்கள் சாத் உதவியாளர். உங்கள் பற்றி சிறிது பேசுவதில் தொடங்கலாமா?',
    };
    const label = AI_LABEL[locale] ?? '[AI] ';
    return label + (g[locale] ?? g['en']!);
  }

  async takeTurn(input: TurnInput): Promise<TurnOutput> {
    const topics: Record<string, string[]> = {
      en: [
        'Tell me about your education and profession.',
        'What matters most to you in a partner?',
        'How do you spend your weekends — lifestyle questions?',
        'Tell me about your family.',
        'Are you open to relocating for a match?',
        'Any firm dealbreakers you already know?',
      ],
      hi: [
        'अपनी पढ़ाई और पेशे के बारे में बताइए।',
        'जीवनसाथी में आपके लिए सबसे ज़रूरी क्या है?',
        'छुट्टियों में आप कैसे समय बिताते हैं?',
        'अपने परिवार के बारे में बताइए।',
        'क्या आप शादी के लिए शहर बदलने को तैयार हैं?',
        'कोई पक्की बात जो बिल्कुल न हो?',
      ],
      ta: [
        'உங்கள் படிப்பு மற்றும் தொழில் பற்றி சொல்லுங்கள்.',
        'துணையில் உங்களுக்கு மிக முக்கியம் எது?',
        'விடுமுறை நாட்களில் என்ன செய்வீர்கள்?',
        'உங்கள் குடும்பம் பற்றி சொல்லுங்கள்.',
        'நகரம் மாற முன்வருவீர்களா?',
        'உங்கள் உறுதியான எதிர்ப்புகள் என்ன?',
      ],
    };
    const list = topics[input.locale] ?? topics['en']!;
    const label = AI_LABEL[input.locale] ?? '[AI] ';
    const next = input.turnCount; // 0-based index into topics
    if (next >= list.length || input.turnCount >= this.maxTurns) {
      return {
        replyText:
          label +
          (input.locale === 'hi'
            ? 'बहुत बढ़िया! मैंने आपकी जानकारी समेट ली है। कृपया अपनी प्रोफ़ाइल की समीक्षा करें और पुष्टि करें।'
            : input.locale === 'ta'
              ? 'மிக அருமை! உங்கள் விவரங்கள் தயார். தயவுசெய்து மதிப்பாய்வு செய்து உறுதிப்படுத்தவும்.'
              : 'Great! I have gathered your details. Please review and confirm your profile.'),
        status: 'awaiting_confirm',
      };
    }
    return { replyText: label + list[next]!, status: 'in_progress' };
  }
}

/** HTTP engine: calls the Python agents service (real A1 state machine). */
export class HttpOnboardingEngine implements OnboardingEngine {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  greeting(): string {
    // The agents service produces the greeting as part of the first turn.
    return '[AI] ';
  }

  async takeTurn(input: TurnInput): Promise<TurnOutput> {
    const res = await this.fetchImpl(`${this.baseUrl}/internal/onboarding/turn`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': this.serviceToken,
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`agents service turn failed: ${res.status}`);
    return (await res.json()) as TurnOutput;
  }
}

export function createOnboardingEngine(config: AppConfig): OnboardingEngine {
  if (config.ONBOARDING_ENGINE_TRANSPORT === 'http') {
    if (!config.AGENTS_SERVICE_URL) {
      throw new Error('AGENTS_SERVICE_URL is required when ONBOARDING_ENGINE_TRANSPORT=http');
    }
    return new HttpOnboardingEngine(config.AGENTS_SERVICE_URL, config.INTERNAL_SERVICE_TOKEN);
  }
  return new MockOnboardingEngine(config.ONBOARDING_MAX_TURNS);
}
