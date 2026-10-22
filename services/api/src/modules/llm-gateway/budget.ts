/**
 * Token budgets (DESIGN.md §6.0, §12.1 T12): per-user daily budgets by plan,
 * plus a global circuit breaker. P0 skeleton keeps counters in memory; the
 * Redis-backed store lands with the notifications/infra work (interface stable).
 */
export interface BudgetStore {
  /** Adds `tokens` to the counter and returns the new total. */
  add(key: string, tokens: number, ttlSec: number): Promise<number>;
  get(key: string): Promise<number>;
}

export class MemoryBudgetStore implements BudgetStore {
  private readonly counters = new Map<string, { total: number; resetAt: number }>();

  async add(key: string, tokens: number, ttlSec: number): Promise<number> {
    const now = Date.now();
    const entry = this.counters.get(key);
    if (!entry || entry.resetAt <= now) {
      this.counters.set(key, { total: tokens, resetAt: now + ttlSec * 1000 });
      return tokens;
    }
    entry.total += tokens;
    return entry.total;
  }

  async get(key: string): Promise<number> {
    const entry = this.counters.get(key);
    if (!entry || entry.resetAt <= Date.now()) return 0;
    return entry.total;
  }
}

export class BudgetExceededError extends Error {
  constructor(readonly scope: 'user' | 'global') {
    super(scope === 'user' ? 'daily token budget exceeded' : 'global circuit breaker open');
  }
}
