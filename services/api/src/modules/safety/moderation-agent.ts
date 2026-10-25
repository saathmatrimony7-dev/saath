/**
 * A9 moderation agent client (P2-05). Core asks the agents service to
 * classify user text (report details today; chat pre-send in P4). Mock in
 * dev/test (refused in production, like the other mock vendors); HTTP client
 * talks to the agents service's service-token route.
 */
import type { AppConfig } from '../../config';
import type { ModerationLabel, ModerationVerdict } from './moderation-agent.tokens';

export interface ModerationAgentClient {
  classify(text: string): Promise<ModerationVerdict>;
}

/** Dev/test: returns 'safe'; tests may script a verdict to exercise the flow. */
export class MockModerationAgent implements ModerationAgentClient {
  scripted: ModerationVerdict | null = null;
  readonly seen: string[] = [];

  async classify(text: string): Promise<ModerationVerdict> {
    this.seen.push(text);
    return this.scripted ?? { label: 'safe', confidence: 1 };
  }
}

const LABELS: readonly string[] = [
  'safe',
  'money_request',
  'off_platform_pressure',
  'scam_script',
  'harassment',
  'sexual_content',
];

/** HTTP client → agents service /internal/moderation/classify. */
export class HttpModerationAgent implements ModerationAgentClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async classify(text: string): Promise<ModerationVerdict> {
    const res = await this.fetchImpl(`${this.baseUrl}/internal/moderation/classify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': this.serviceToken,
      },
      body: JSON.stringify({ text, context: 'report' }),
    });
    if (!res.ok) throw new Error(`A9 classify failed with status ${res.status}`);
    const body = (await res.json()) as { label?: string; confidence?: number };
    if (!body.label || !LABELS.includes(body.label)) {
      throw new Error('A9 returned an unknown label');
    }
    return {
      label: body.label as ModerationLabel,
      confidence: typeof body.confidence === 'number' ? body.confidence : 0,
    };
  }
}

export function createModerationAgent(config: AppConfig): ModerationAgentClient {
  return config.MODERATION_AGENT_TRANSPORT === 'http'
    ? new HttpModerationAgent(config.AGENTS_SERVICE_URL ?? '', config.INTERNAL_SERVICE_TOKEN)
    : new MockModerationAgent();
}
