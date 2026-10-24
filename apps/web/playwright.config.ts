import { defineConfig } from '@playwright/test';

/**
 * P1-08 e2e: sign up via OTP (mock SMS) and complete the onboarding interview
 * in English and Hindi through the real Next.js app + Core API (mock engine).
 *
 * Boots both servers itself:
 *  - Core API e2e server on :3100 (embedded PG, migrations, mock OTP/engine,
 *    test-only GET /__e2e/otp code read-back)
 *  - Next.js dev server on :3101 (proxies /api/core/* to the API)
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  webServer: [
    {
      command: 'pnpm --dir ../../services/api run e2e:serve',
      port: 3100,
      timeout: 240_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm exec next dev -p 3101',
      port: 3101,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { ...process.env, CORE_API_URL: 'http://127.0.0.1:3100', PORT: '3101' },
    },
  ],
  use: {
    baseURL: 'http://localhost:3101',
    locale: 'en-IN',
  },
});
