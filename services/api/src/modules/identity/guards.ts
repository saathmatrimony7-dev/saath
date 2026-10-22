/**
 * Auth guards + cookie helpers (DESIGN.md §12.2).
 * - AuthGuard: verifies the ES256 access JWT from the auth cookie.
 * - CsrfGuard: double-submit check for cookie-authenticated mutating requests.
 * - Cookies: httpOnly + Secure (in deployed envs) + SameSite=Lax.
 */
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import {
  createParamDecorator,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { TokenService } from './token.service';
import type { AppConfig } from '../../config';

export const ACCESS_COOKIE = 'saath_at';
export const REFRESH_COOKIE = 'saath_rt';
export const CSRF_COOKIE = 'saath_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export function cookieOptions(config: AppConfig, maxAgeSec: number, httpOnly = true) {
  return {
    httpOnly,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSec * 1000,
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  };
}

export function setAuthCookies(
  res: Response,
  config: AppConfig,
  accessToken: string,
  refreshToken: string,
): string {
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(config, config.JWT_ACCESS_TTL_SEC));
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(config, config.REFRESH_TOKEN_TTL_SEC));
  const csrf = randomBytes(16).toString('base64url');
  // Not httpOnly: the web client reads it and echoes it in X-CSRF-Token.
  res.cookie(CSRF_COOKIE, csrf, cookieOptions(config, config.REFRESH_TOKEN_TTL_SEC, false));
  return csrf;
}

export function clearAuthCookies(res: Response, config: AppConfig): void {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE]) {
    res.clearCookie(name, cookieOptions(config, 0, name !== CSRF_COOKIE));
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(TokenService) private readonly tokens: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { userId?: string; sessionId?: string }>();
    const token = req.cookies?.[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedException('missing access token');
    try {
      const payload = await this.tokens.verifyAccessToken(token);
      req.userId = payload.sub;
      req.sessionId = payload.sid;
      return true;
    } catch {
      throw new UnauthorizedException('invalid or expired access token');
    }
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const cookie = req.cookies?.[CSRF_COOKIE];
    const header = req.headers[CSRF_HEADER];
    if (!cookie || !header || cookie !== header) {
      throw new ForbiddenException('CSRF token missing or mismatched');
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ userId?: string }>();
  if (!req.userId) throw new UnauthorizedException();
  return req.userId;
});
