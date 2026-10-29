/**
 * Screening broker client (P3-07). Core's `request_screening` tool (A4)
 * delegates the §7.3 protocol to the A6 broker living in the agents
 * service. Mock in dev/test/benchmark (deterministic verdict, refused in
 * production like the other mock vendors); http calls the agents service's
 * service-token route.
 */
import type { AppConfig } from '../../config';
import { verdictSchema } from '../screening/screening.dto';

export interface BrokerVerdict {
  verdict: 'COMPATIBLE' | 'PARTIAL' | 'INCOMPATIBLE';
  score: number;
}

export interface ScreeningBrokerClient {
  screen(aUserId: string, bUserId: string): Promise<BrokerVerdict>;
}

/** Deterministic per-pair verdict for dev/test/benchmark (no LLM). */
export class MockScreeningBroker implements ScreeningBrokerClient {
  scripted: BrokerVerdict | null = null;
  readonly seen: string[] = [];

  async screen(aUserId: string, bUserId: string): Promise<BrokerVerdict> {
    this.seen.push([aUserId, bUserId].sort().join('|'));
    if (this.scripted) return this.scripted;
    // ~70% compatible / 20% partial / 10% incompatible, stable per pair.
    let h = 0;
    for (const ch of [aUserId, bUserId].sort().join('|')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const bucket = h % 10;
    if (bucket < 7) return { verdict: 'COMPATIBLE', score: 0.7 + (h % 30) / 100 };
    if (bucket < 9) return { verdict: 'PARTIAL', score: 0.45 + (h % 20) / 100 };
    return { verdict: 'INCOMPATIBLE', score: 0.2 };
  }
}

/** HTTP client → agents service /internal/screening/run. */
export class HttpScreeningBroker implements ScreeningBrokerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async screen(aUserId: string, bUserId: string): Promise<BrokerVerdict> {
    const res = await this.fetchImpl(`${this.baseUrl}/internal/screening/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': this.serviceToken,
      },
      body: JSON.stringify({ aUserId, bUserId }),
    });
    if (!res.ok) throw new Error(`A6 screening run failed with status ${res.status}`);
    const body = (await res.json()) as { verdict?: unknown; score?: unknown };
    const verdict = verdictSchema.safeParse(body.verdict);
    if (!verdict.success || typeof body.score !== 'number') {
      throw new Error('A6 returned a malformed verdict');
    }
    return { verdict: verdict.data, score: body.score };
  }
}

export function createScreeningBroker(config: AppConfig): ScreeningBrokerClient {
  return config.SCREENING_BROKER_TRANSPORT === 'http'
    ? new HttpScreeningBroker(config.AGENTS_SERVICE_URL ?? '', config.INTERNAL_SERVICE_TOKEN)
    : new MockScreeningBroker();
}
