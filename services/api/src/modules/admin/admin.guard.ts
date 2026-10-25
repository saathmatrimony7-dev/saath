/**
 * Admin guard (P2-06, DESIGN.md §12.2 T7): RBAC role in the JWT claim, or an
 * ACTIVE JIT elevation (time-boxed, recorded). Every request passing this
 * guard is audited by the handlers via AuditService — denials are not logged
 * here to keep the guard side-effect free.
 */
import type {
  CanActivate,
  ExecutionContext} from '@nestjs/common';
import {
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from '../identity/token.service';
import { ACCESS_COOKIE } from '../identity/guards';

const ADMIN_ROLES = new Set(['admin', 'superadmin']);

/** Attached to the request after AdminGuard succeeds. */
export interface AdminRequest extends Request {
  adminId: string;
  adminVia: 'role' | 'jit';
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const token = req.cookies?.[ACCESS_COOKIE];
    if (!token) throw new ForbiddenException('admin access required');

    let payload;
    try {
      payload = await this.tokens.verifyAccessToken(token);
    } catch {
      throw new ForbiddenException('admin access required');
    }

    if (ADMIN_ROLES.has(payload.role)) {
      req.adminId = payload.sub;
      req.adminVia = 'role';
      return true;
    }

    // JIT: an unexpired, unrevoked elevation row (owner context sees own rows).
    const now = new Date();
    const elevation = await this.prisma.withUser(payload.sub, (tx) =>
      tx.adminElevation.findFirst({
        where: { userId: payload.sub, revokedAt: null, expiresAt: { gt: now } },
        orderBy: { expiresAt: 'desc' },
      }),
    );
    if (elevation) {
      req.adminId = payload.sub;
      req.adminVia = 'jit';
      return true;
    }
    throw new ForbiddenException('admin access required');
  }
}
