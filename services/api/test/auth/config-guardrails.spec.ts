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
  ONBOARDING_ENGINE_TRANSPORT: 'http',
  AGENTS_SERVICE_URL: 'http://127.0.0.1:8000',
  WHATSAPP_PROVIDER: 'meta',
  WHATSAPP_WEBHOOK_SECRET: 'prod-webhook-secret-0123456789',
  KYC_PROVIDER: 'idfy',
  KYC_WEBHOOK_SECRET: 'prod-kyc-webhook-secret-0123456789',
  MODERATION_AGENT_TRANSPORT: 'http',
  SCREENING_BROKER_TRANSPORT: 'http',
  FAMILY_SUMMARISER_TRANSPORT: 'http',
  // P4: messaging/billing/coordinator production wiring
  CALL_PROVIDER: 'exotel',
  RAZORPAY_PROVIDER: 'razorpay',
  RAZORPAY_WEBHOOK_SECRET: 'prod-razorpay-webhook-secret-0123456789',
  COORDINATOR_TRANSPORT: 'http',
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

  it('refuses ONBOARDING_ENGINE_TRANSPORT=mock in production', () => {
    expect(() => loadConfig({ ...baseEnv, ONBOARDING_ENGINE_TRANSPORT: 'mock' })).toThrow(
      /ONBOARDING_ENGINE_TRANSPORT=mock/,
    );
  });

  it('refuses WHATSAPP_PROVIDER=mock in production', () => {
    expect(() => loadConfig({ ...baseEnv, WHATSAPP_PROVIDER: 'mock' })).toThrow(
      /WHATSAPP_PROVIDER=mock/,
    );
  });

  it('refuses the development webhook secret in production', () => {
    expect(() => loadConfig({ ...baseEnv, WHATSAPP_WEBHOOK_SECRET: undefined })).toThrow(
      /WHATSAPP_WEBHOOK_SECRET/,
    );
  });

  it('refuses KYC_PROVIDER=mock in production', () => {
    expect(() => loadConfig({ ...baseEnv, KYC_PROVIDER: 'mock' })).toThrow(/KYC_PROVIDER=mock/);
  });

  it('refuses the development KYC webhook secret in production', () => {
    expect(() => loadConfig({ ...baseEnv, KYC_WEBHOOK_SECRET: undefined })).toThrow(
      /KYC_WEBHOOK_SECRET/,
    );
  });

  it('refuses MODERATION_AGENT_TRANSPORT=mock in production', () => {
    expect(() => loadConfig({ ...baseEnv, MODERATION_AGENT_TRANSPORT: 'mock' })).toThrow(
      /MODERATION_AGENT_TRANSPORT=mock/,
    );
  });

  it('refuses SCREENING_BROKER_TRANSPORT=mock in production', () => {
    expect(() => loadConfig({ ...baseEnv, SCREENING_BROKER_TRANSPORT: 'mock' })).toThrow(
      /SCREENING_BROKER_TRANSPORT=mock/,
    );
  });

  it('refuses FAMILY_SUMMARISER_TRANSPORT=mock in production', () => {
    expect(() => loadConfig({ ...baseEnv, FAMILY_SUMMARISER_TRANSPORT: 'mock' })).toThrow(
      /FAMILY_SUMMARISER_TRANSPORT=mock/,
    );
  });

  it('refuses CALL_PROVIDER=mock in production', () => {
    expect(() => loadConfig({ ...baseEnv, CALL_PROVIDER: 'mock' })).toThrow(/CALL_PROVIDER=mock/);
  });

  it('refuses RAZORPAY_PROVIDER=mock in production', () => {
    expect(() => loadConfig({ ...baseEnv, RAZORPAY_PROVIDER: 'mock' })).toThrow(
      /RAZORPAY_PROVIDER=mock/,
    );
  });

  it('refuses the development Razorpay webhook secret in production', () => {
    expect(() => loadConfig({ ...baseEnv, RAZORPAY_WEBHOOK_SECRET: undefined })).toThrow(
      /RAZORPAY_WEBHOOK_SECRET/,
    );
  });

  it('refuses COORDINATOR_TRANSPORT=mock in production', () => {
    expect(() => loadConfig({ ...baseEnv, COORDINATOR_TRANSPORT: 'mock' })).toThrow(
      /COORDINATOR_TRANSPORT=mock/,
    );
  });
});
