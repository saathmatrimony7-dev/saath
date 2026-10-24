import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * The Core API sets httpOnly auth cookies for the web origin. Rather than
 * opening CORS, the web app proxies /api/core/* to the API server-side, so
 * the browser sees only same-origin requests and SameSite=Lax cookies work.
 */
const coreApiUrl = process.env.CORE_API_URL ?? 'http://127.0.0.1:3000';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/core/:path*', destination: `${coreApiUrl}/v1/:path*` }];
  },
};

export default withNextIntl(nextConfig);
