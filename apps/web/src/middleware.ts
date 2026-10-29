import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { isLocale, routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

/** Paths that require a session cookie (the API sets saath_at httpOnly). */
const PROTECTED_SEGMENTS = ['/onboarding', '/profile', '/family'];

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED_SEGMENTS.some((segment) => pathname.includes(segment));
  if (isProtected && !req.cookies.get('saath_at')) {
    const maybeLocale = pathname.split('/')[1];
    const locale = isLocale(maybeLocale) ? maybeLocale : routing.defaultLocale;
    const url = req.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    return NextResponse.redirect(url);
  }
  return intlMiddleware(req);
}

export const config = {
  // Skip the api proxy, Next internals and static files.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
