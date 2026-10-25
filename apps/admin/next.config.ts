import type { NextConfig } from 'next';

/**
 * Same-origin proxy to the Core API as apps/web (no CORS; auth cookies stay
 * httpOnly). English-only internal console (rule 14 covers user-facing UI;
 * this is a staff tool — deviation documented in README).
 */
const coreApiUrl = process.env.CORE_API_URL ?? 'http://127.0.0.1:3000';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/core/:path*', destination: `${coreApiUrl}/v1/:path*` }];
  },
};

export default nextConfig;
