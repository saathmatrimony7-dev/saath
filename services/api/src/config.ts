/**
 * Runtime configuration, parsed and validated with Zod at boot.
 * All secrets come from the environment (locally: git-ignored .env.local;
 * cloud: AWS Secrets Manager). Never log this object.
 */
import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),

  // JWT (ES256, asymmetric; kid rotation per DESIGN.md §12.2)
  JWT_ISSUER: z.string().default('saath-dev'),
  JWT_KEY_ID: z.string().default('dev-key-1'),
  JWT_PRIVATE_KEY_ES256_B64: z.string().min(1),
  JWT_PUBLIC_KEY_ES256_B64: z.string().min(1),
  JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(600), // 10 min

  // Refresh tokens (opaque, stored hashed, rotate on use)
  REFRESH_TOKEN_TTL_SEC: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 24 * 3600),

  // OTP (DESIGN.md §12.2: 6 digits, 5 min, 3 attempts, 5 req/hour per number and IP)
  OTP_PROVIDER: z.enum(['mock', 'msg91']).default('mock'),
  OTP_TTL_SEC: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  OTP_REQUESTS_PER_HOUR: z.coerce.number().int().positive().default(5),
  OTP_IP_REQUESTS_PER_HOUR: z.coerce.number().int().positive().default(5),
  OTP_PEPPER: z.string().min(16), // server-side pepper for OTP hashing
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),

  // Field-level encryption
  FLE_MASTER_KEY_B64: z.string().min(1),

  // Internal service-to-service token (agents/workers → /internal/*)
  INTERNAL_SERVICE_TOKEN: z.string().min(16),

  // HMAC secret for scoped agent tokens (x-agent-token on /internal/tools/*).
  // Must match services/agents' agent_token_secret. Dev default only.
  AGENT_TOKEN_HMAC_SECRET: z.string().min(16).default('dev-agent-token-hmac-secret'),

  // LLM Gateway (Claude API only; model names are config, rule 13)
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_GATEWAY_TRANSPORT: z.enum(['mock', 'anthropic']).default('mock'),
  LLM_MODEL_SMALL: z.string().default('claude-haiku-5-5'),
  LLM_MODEL_MID: z.string().default('claude-sonnet-5-5'),
  LLM_MODEL_LARGE: z.string().default('claude-opus-5-5'),
  LLM_DAILY_TOKEN_BUDGET_FREE: z.coerce.number().int().positive().default(20_000),
  LLM_DAILY_TOKEN_BUDGET_PAID: z.coerce.number().int().positive().default(200_000),
  LLM_GLOBAL_CIRCUIT_BREAKER_TOKENS: z.coerce.number().int().positive().default(50_000_000),

  // Photos + object storage (P1-04). Mock provider is disk-backed and
  // HMAC-signed; S3 wiring lands with cloud infra (P2).
  STORAGE_PROVIDER: z.enum(['mock', 's3']).default('mock'),
  STORAGE_SIGNING_SECRET: z.string().min(16).default('dev-storage-signing-secret'),
  STORAGE_DIR: z.string().default('.data/storage'),
  PHOTOS_MAX_COUNT: z.coerce.number().int().positive().default(6),
  PHOTOS_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10_485_760), // 10 MB
  PHOTOS_URL_TTL_SEC: z.coerce.number().int().positive().default(900),

  // A1 onboarding engine (P1-06): the real interview state machine runs in
  // the agents service; Core drives it over HTTP. Mock = scripted engine for
  // tests/dev (refused in production, like the other mock vendors).
  ONBOARDING_ENGINE_TRANSPORT: z.enum(['mock', 'http']).default('mock'),
  ONBOARDING_MAX_TURNS: z.coerce.number().int().positive().default(25),
  AGENTS_SERVICE_URL: z.string().url().optional(),

  // WhatsApp channel (P1-09, DESIGN.md §12): ChannelAdapter + signature-verified
  // webhook driving the SAME A1 session engine as the web app. Mock adapter in
  // dev/test; Meta Cloud API wiring is config-only for now.
  WHATSAPP_PROVIDER: z.enum(['mock', 'meta']).default('mock'),
  WHATSAPP_WEBHOOK_SECRET: z.string().min(16).default('dev-whatsapp-webhook-secret'),
  WHATSAPP_VERIFY_TOKEN: z.string().default('dev-whatsapp-verify-token'),
  WHATSAPP_OPTOUT_KEYWORDS: z.string().default('stop'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),

  // KYC (P2-01, DESIGN.md A10.4): provider behind an interface; mock in dev.
  // Raw KYC documents are never stored — results arrive via signed webhook.
  KYC_PROVIDER: z.enum(['mock', 'idfy']).default('mock'),
  KYC_WEBHOOK_SECRET: z.string().min(16).default('dev-kyc-webhook-secret'),
  IDFY_ACCOUNT_ID: z.string().optional(),
  IDFY_API_KEY: z.string().optional(),

  // A9 moderation agent (P2-05): report text is classified by the agents
  // service; chat pre-send checks land in P4. Mock in dev/test.
  MODERATION_AGENT_TRANSPORT: z.enum(['mock', 'http']).default('mock'),

  // Consent ledger (P1-02): notice version stamped on every consent row.
  // Bump when the privacy notice text changes; do not reuse old versions.
  CONSENT_NOTICE_VERSION: z.string().default('2026-10-23.v1'),

  // Cookies
  COOKIE_SECURE: z.stringbool().default(false), // must be true in staging/prod (HTTPS)
  COOKIE_DOMAIN: z.string().optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    // Never log values — only the failing keys.
    const keys = parsed.error.issues.map((i) => i.path.join('.'));
    throw new Error(`Invalid configuration keys: ${keys.join(', ')}`);
  }
  const cfg = parsed.data;

  // Production safety rails (security review P0-12): mocks and insecure
  // cookies must never reach prod by misconfiguration.
  if (cfg.NODE_ENV === 'production') {
    const violations: string[] = [];
    if (cfg.OTP_PROVIDER === 'mock') violations.push('OTP_PROVIDER=mock');
    if (cfg.LLM_GATEWAY_TRANSPORT === 'mock') violations.push('LLM_GATEWAY_TRANSPORT=mock');
    if (cfg.STORAGE_PROVIDER === 'mock') violations.push('STORAGE_PROVIDER=mock');
    if (cfg.ONBOARDING_ENGINE_TRANSPORT === 'mock') {
      violations.push('ONBOARDING_ENGINE_TRANSPORT=mock');
    }
    if (cfg.WHATSAPP_PROVIDER === 'mock') violations.push('WHATSAPP_PROVIDER=mock');
    if (cfg.WHATSAPP_WEBHOOK_SECRET === 'dev-whatsapp-webhook-secret') {
      violations.push('WHATSAPP_WEBHOOK_SECRET is the development default');
    }
    if (cfg.KYC_PROVIDER === 'mock') violations.push('KYC_PROVIDER=mock');
    if (cfg.KYC_WEBHOOK_SECRET === 'dev-kyc-webhook-secret') {
      violations.push('KYC_WEBHOOK_SECRET is the development default');
    }
    if (cfg.MODERATION_AGENT_TRANSPORT === 'mock') {
      violations.push('MODERATION_AGENT_TRANSPORT=mock');
    }
    if (!cfg.COOKIE_SECURE) violations.push('COOKIE_SECURE=false');
    if (violations.length > 0) {
      throw new Error(`Refusing to boot in production with: ${violations.join(', ')}`);
    }
  }
  return cfg;
}
