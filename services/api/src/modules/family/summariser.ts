/**
 * A7 Family Liaison summariser transport (P3-10, DESIGN.md §6 A7, mid tier).
 *
 * Mirrors the screening-broker pattern: a Core-side interface with a
 * deterministic mock (dev/test, refused in production via the config
 * guardrail) and an HTTP client to the agents service's service-token
 * route. The agents-side engine calls the LLM Gateway (tier mid) in the
 * owner's language; the payload is STRUCTURED SIGNALS ONLY — no comments,
 * so no C4 material ever crosses to the LLM.
 */
import type { AppConfig } from '../../config';

export interface FamilySignalItem {
  candidateId: string;
  signals: string[]; // closed vocabulary: approve | reject | interested | concern
}

export interface FamilySummariserClient {
  summarise(input: { ownerId: string; locale: string; items: FamilySignalItem[] }): Promise<string>;
}

/** Deterministic per-locale template (plumbing-only stand-in). */
export class MockFamilySummariser implements FamilySummariserClient {
  async summarise(input: {
    ownerId: string;
    locale: string;
    items: FamilySignalItem[];
  }): Promise<string> {
    const counts: Record<string, number> = {};
    for (const item of input.items) {
      for (const s of item.signals) counts[s] = (counts[s] ?? 0) + 1;
    }
    const total = input.items.reduce((n, i) => n + i.signals.length, 0);
    const parts =
      Object.entries(counts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([s, n]) => `${n} ${s}`)
        .join(', ') || 'no signals yet';
    const byLocale: Record<string, string> = {
      en: `Family feedback on ${input.items.length} shortlisted profile(s): ${parts} (${total} signal(s) total).`,
      hi: `${input.items.length} शॉर्टलिस्ट की गई प्रोफ़ाइल पर पारिवारिक प्रतिक्रिया: ${parts} (कुल ${total} संकेत)।`,
      ta: `${input.items.length} குறுக்குப்பட்டியல் சுயவிவரங்களில் குடும்ப கருத்து: ${parts} (மொத்தம் ${total} சமிக்ஞைகள்).`,
    };
    return byLocale[input.locale] ?? byLocale.en!;
  }
}

/** HTTP client → agents service /internal/family/summarise. */
export class HttpFamilySummariser implements FamilySummariserClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async summarise(input: {
    ownerId: string;
    locale: string;
    items: FamilySignalItem[];
  }): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl}/internal/family/summarise`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': this.serviceToken,
      },
      body: JSON.stringify({
        ownerId: input.ownerId,
        locale: input.locale,
        items: input.items,
      }),
    });
    if (!res.ok) throw new Error(`family summariser HTTP ${res.status}`);
    const data = (await res.json()) as { summary: string };
    return data.summary;
  }
}

export function createFamilySummariser(config: AppConfig): FamilySummariserClient {
  if (config.FAMILY_SUMMARISER_TRANSPORT === 'http') {
    if (!config.AGENTS_SERVICE_URL) {
      throw new Error('AGENTS_SERVICE_URL is required when FAMILY_SUMMARISER_TRANSPORT=http');
    }
    return new HttpFamilySummariser(config.AGENTS_SERVICE_URL, config.INTERNAL_SERVICE_TOKEN);
  }
  return new MockFamilySummariser();
}
