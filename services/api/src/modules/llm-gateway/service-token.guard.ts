/**
 * Internal service-token guard for /internal/* (DESIGN.md §11: agent↔API calls
 * use scoped tokens; mTLS terminates at the load balancer in deployed envs).
 * Constant-time comparison; token comes from config/Secrets Manager.
 */
import { CanActivate, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { AppConfig } from '../../config';
import { APP_CONFIG } from '../identity/tokens';

@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const presented = req.headers['x-internal-token'];
    const expected = this.config.INTERNAL_SERVICE_TOKEN;
    if (typeof presented !== 'string' || !expected) {
      throw new UnauthorizedException('missing internal service token');
    }
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('invalid internal service token');
    }
    return true;
  }
}
