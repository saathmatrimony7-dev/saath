/**
 * Fixed-window rate limiter (DESIGN.md §12.3).
 * Store is pluggable: in-memory for local/tests, Redis-backed in deployed
 * environments (Redis store ships with the notifications/infra work — the
 * interface is stable now).
 */
export interface RateLimitStore {
  /** Increments and returns the count for `key` within the current window. */
  incr(key: string, windowSec: number): Promise<number>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  async incr(key: string, windowSec: number): Promise<number> {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowSec * 1000 });
      return 1;
    }
    bucket.count += 1;
    return bucket.count;
  }
}

export class RateLimiter {
  constructor(private readonly store: RateLimitStore) {}

  /** @returns true if the action is allowed, false if the limit is exceeded. */
  async allow(key: string, limit: number, windowSec: number): Promise<boolean> {
    const count = await this.store.incr(key, windowSec);
    return count <= limit;
  }
}
