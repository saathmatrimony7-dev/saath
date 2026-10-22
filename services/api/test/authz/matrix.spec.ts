/**
 * Authorisation-matrix tests (endpoint × role: anonymous / owner / other member /
 * family / support / moderator / admin — see qa-engineer role).
 *
 * P0-08 adds the auth endpoints; this placeholder keeps the nightly CI job
 * (`pnpm --filter @saath/api test:authz`) green until then.
 */
import { describe, it, expect } from 'vitest';

describe('authorisation matrix', () => {
  it.todo('POST /v1/auth/otp/request — anonymous allowed, rate-limited');
  it.todo('POST /v1/auth/otp/verify — anonymous allowed, attempt-limited');
  it.todo('POST /v1/auth/refresh — rotates, reuse revokes token family');

  it('placeholder passes so the suite is green before endpoints exist', () => {
    expect(true).toBe(true);
  });
});
