/**
 * A8 coordinator client (P4-09, DESIGN.md §6.1 A8): icebreakers + call/meet
 * slot suggestions. Hard rule: A8 NEVER sends anything to the other person —
 * its output is suggestions for its own user only (the tools back that:
 * send_nudge notifies the caller's own user).
 *
 * Mock renders deterministic templates from closed-vocabulary conversation
 * facts (never chat bodies — C4 stays in Core). HTTP transport calls the
 * agents service's service-token route.
 */
import type { AppConfig } from '../../config';

export interface CoordinatorSuggestionInput {
  userId: string;
  conversationId: string;
  origin: string;
  contactShared: boolean;
  proposedSlots: unknown;
}

export interface CoordinatorSuggestions {
  icebreakers: string[];
  slots: string[];
}

export interface CoordinatorClient {
  suggest(input: CoordinatorSuggestionInput): Promise<CoordinatorSuggestions>;
}

export class MockCoordinatorClient implements CoordinatorClient {
  async suggest(input: CoordinatorSuggestionInput): Promise<CoordinatorSuggestions> {
    const icebreakers = [
      'Ask what a perfect weekend looks like for them.',
      'Share the story behind your city — and ask about theirs.',
      'Talk about one tradition that matters to your family.',
    ];
    if (input.origin === 'intro') {
      icebreakers.unshift('Introduce yourself and mention what caught your interest.');
    }
    if (input.contactShared) {
      icebreakers.push('You have both opted in to share contacts — agree on a time to talk.');
    }
    return { icebreakers, slots: [] };
  }
}

export class HttpCoordinatorClient implements CoordinatorClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async suggest(input: CoordinatorSuggestionInput): Promise<CoordinatorSuggestions> {
    const res = await this.fetchImpl(`${this.baseUrl}/internal/coordinator/suggest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': this.serviceToken,
      },
      body: JSON.stringify({
        userId: input.userId,
        conversationId: input.conversationId,
        origin: input.origin,
        contactShared: input.contactShared,
      }),
    });
    if (!res.ok) throw new Error(`A8 suggest failed with status ${res.status}`);
    const body = (await res.json()) as { icebreakers?: string[]; slots?: string[] };
    return {
      icebreakers: Array.isArray(body.icebreakers) ? body.icebreakers : [],
      slots: Array.isArray(body.slots) ? body.slots : [],
    };
  }
}

export function createCoordinatorClient(config: AppConfig): CoordinatorClient {
  return config.COORDINATOR_TRANSPORT === 'http'
    ? new HttpCoordinatorClient(config.AGENTS_SERVICE_URL ?? '', config.INTERNAL_SERVICE_TOKEN)
    : new MockCoordinatorClient();
}
