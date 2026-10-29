/**
 * Masked-call provider bridge (P4-04, DESIGN.md §14 + D2). The provider
 * connects both parties without revealing either number; Core stores only
 * the provider reference and the call outcome — never phone numbers.
 * Mock in dev/test (refused in production, like the other mock vendors);
 * the Exotel wiring is config-only for now.
 */
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config';

export interface CallBridge {
  /** Bridges the two participants; returns the provider-side call ref. */
  initiate(conversationId: string): Promise<{ providerRef: string }>;
}

export class MockCallProvider implements CallBridge {
  async initiate(conversationId: string): Promise<{ providerRef: string }> {
    return { providerRef: `call_mock_${conversationId.slice(0, 8)}_${randomUUID().slice(0, 8)}` };
  }
}

export class ExotelCallProvider implements CallBridge {
  initiate(): Promise<{ providerRef: string }> {
    throw new Error('Exotel masked-call wiring lands with cloud telephony config (P5)');
  }
}

export function createCallProvider(config: AppConfig): CallBridge {
  return config.CALL_PROVIDER === 'exotel' ? new ExotelCallProvider() : new MockCallProvider();
}
