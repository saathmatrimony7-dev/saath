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

  // Cookies
  COOKIE_SECURE: z.coerce.boolean().default(false), // true in staging/prod (HTTPS)
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
  return parsed.data;
}
