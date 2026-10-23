/** Production safety rails (security review P0-12 findings S1–S3). */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config';

const baseEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app_login:x@127.0.0.1:5432/saath',
  JWT_PRIVATE_KEY_ES256_B64: 'a2V5',
  JWT_PUBLIC_KEY_ES256_B64: 'cHVi',
  OTP_PEPPER: '0123456789abcdef',
  FLE_MASTER_KEY_B64: 'a2V5',
  INTERNAL_SERVICE_TOKEN: 'internal-token-0123456789',
  OTP_PROVIDER: 'msg91',
  LLM_GATEWAY_TRANSPORT: 'anthropic',
  STORAGE_PROVIDER: 's3',
  COOKIE_SECURE: 'true',
} as NodeJS.ProcessEnv;

describe('production config guardrails', () => {
  it('accepts a fully production-safe config', () => {
    expect(loadConfig(baseEnv).NODE_ENV).toBe('production');
  });

  it('refuses OTP_PROVIDER=mock in production', () => {
    expect(() => loadConfig({ ...baseEnv, OTP_PROVIDER: 'mock' })).toThrow(/OTP_PROVIDER=mock/);
  });

  it('refuses LLM_GATEWAY_TRANSPORT=mock in production', () => {
    expect(() => loadConfig({ ...baseEnv, LLM_GATEWAY_TRANSPORT: 'mock' })).toThrow(
      /LLM_GATEWAY_TRANSPORT=mock/,
    );
  });

  it('refuses COOKIE_SECURE=false in production', () => {
    expect(() => loadConfig({ ...baseEnv, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE=false/);
  });

  it('refuses STORAGE_PROVIDER=mock in production', () => {
    expect(() => loadConfig({ ...baseEnv, STORAGE_PROVIDER: 'mock' })).toThrow(
      /STORAGE_PROVIDER=mock/,
    );
  });
});
