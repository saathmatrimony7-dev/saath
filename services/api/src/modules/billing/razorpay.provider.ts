/**
 * Razorpay provider boundary (P4-06, DESIGN.md §13): subscriptions for
 * recurring plans, orders for one-time intro packs. Mock in dev/test —
 * issues deterministic local refs and is refused in production (config
 * guardrail), like the other mock vendors. The real API client (customer +
 * plan entity mapping) lands with cloud billing wiring (P5).
 */
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config';

export interface RazorpayProvider {
  createSubscription(planCode: string): Promise<{ providerSubId: string }>;
  cancelSubscription(providerSubId: string): Promise<void>;
  createOrder(planCode: string, amountPaise: number): Promise<{ providerOrderId: string }>;
}

export class MockRazorpayProvider implements RazorpayProvider {
  async createSubscription(planCode: string): Promise<{ providerSubId: string }> {
    return { providerSubId: `sub_mock_${planCode}_${randomUUID()}` };
  }

  async cancelSubscription(): Promise<void> {
    // Mock: nothing to cancel upstream.
  }

  async createOrder(planCode: string): Promise<{ providerOrderId: string }> {
    return { providerOrderId: `order_mock_${planCode}_${randomUUID()}` };
  }
}

export class RazorpayApiProvider implements RazorpayProvider {
  createSubscription(): Promise<{ providerSubId: string }> {
    throw new Error('Razorpay API client lands with cloud billing wiring (P5)');
  }

  cancelSubscription(): Promise<void> {
    throw new Error('Razorpay API client lands with cloud billing wiring (P5)');
  }

  createOrder(): Promise<{ providerOrderId: string }> {
    throw new Error('Razorpay API client lands with cloud billing wiring (P5)');
  }
}

export function createRazorpayProvider(config: AppConfig): RazorpayProvider {
  return config.RAZORPAY_PROVIDER === 'razorpay'
    ? new RazorpayApiProvider()
    : new MockRazorpayProvider();
}
