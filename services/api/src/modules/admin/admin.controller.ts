/**
 * Admin endpoints (P2-06). Every handler records an audit row — views AND
 * actions (exit criterion 3: every admin view audited). Authorisation is
 * AdminGuard (role claim or active JIT elevation); CSRF on mutations.
 */
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthGuard, CsrfGuard, ACCESS_COOKIE } from '../identity/guards';
import { TokenService } from '../identity/token.service';
import { AdminGuard, type AdminRequest } from './admin.guard';
import { AdminService } from './admin.service';
import { AuditService } from './audit.service';
const elevateSchema = z.object({ reason: z.string().min(3).max(200) }).strict();
const decideSchema = z
  .object({
    status: z.enum(['resolved', 'dismissed']),
    decision: z.string().min(3).max(500),
  })
  .strict();

const STAFF_ROLES = new Set(['support', 'moderator', 'admin', 'superadmin']);

/**
 * JIT elevation endpoints are NOT behind AdminGuard — that would be a
 * chicken-and-egg for support/moderator staff. AuthGuard + staff-role check
 * only; the elevated privileges themselves stay behind AdminGuard.
 */
@Controller('admin/jit')
@UseGuards(AuthGuard)
export class AdminJitController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  private async staffId(req: AdminRequest): Promise<string> {
    const payload = await this.tokens.verifyAccessToken(req.cookies?.[ACCESS_COOKIE] ?? '');
    if (!STAFF_ROLES.has(payload.role)) throw new ForbiddenException('staff role required');
    req.adminId = payload.sub;
    return payload.sub;
  }

  @Post('elevate')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async elevate(
    @Req() req: AdminRequest,
    @Body(new ZodValidationPipe(elevateSchema)) body: { reason: string },
  ) {
    const userId = await this.staffId(req);
    const result = await this.admin.elevate(userId, body.reason);
    await this.audit.record(userId, 'admin.action.jit_elevate', 'elevation', result.elevationId, {
      via: 'jit',
      expiresAt: result.expiresAt,
    });
    return result;
  }

  @Post('drop')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async drop(@Req() req: AdminRequest) {
    const userId = await this.staffId(req);
    const result = await this.admin.drop(userId);
    await this.audit.record(userId, 'admin.action.jit_drop', 'elevation', userId, { via: 'jit' });
    return result;
  }
}

@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ---- (JIT endpoints live in AdminJitController: staff-role + AuthGuard) ----

  // ---- User directory (C4 masked) ----

  @Get('users')
  async users(@Req() req: AdminRequest, @Query('limit') limit?: string) {
    const result = await this.admin.listUsers(limit ? Number(limit) : 50);
    await this.audit.record(req.adminId, 'admin.view.users', 'user', undefined, {
      count: result.length,
    });
    return result;
  }

  @Get('users/:id')
  async user(@Req() req: AdminRequest, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.admin.getUser(id);
    await this.audit.record(req.adminId, 'admin.view.user', 'user', id);
    return result;
  }

  // ---- Safety case queue ----

  @Get('cases')
  async cases(@Req() req: AdminRequest, @Query('status') status?: string) {
    const result = await this.admin.listCases(status ?? 'open');
    await this.audit.record(req.adminId, 'admin.view.cases', 'case', undefined, {
      status: status ?? 'open',
      count: result.length,
    });
    return result;
  }

  @Post('cases/:id/decide')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  async decide(
    @Req() req: AdminRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decideSchema))
    body: { status: 'resolved' | 'dismissed'; decision: string },
  ) {
    const result = await this.admin.decideCase(req.adminId, id, body.status, body.decision);
    await this.audit.record(req.adminId, 'admin.action.case_decide', 'case', id, {
      status: body.status,
      via: req.adminVia,
    });
    return result;
  }

  // ---- Audit browser ----

  @Get('audit')
  async auditLog(@Req() req: AdminRequest, @Query('limit') limit?: string) {
    const result = await this.audit.recent(limit ? Number(limit) : 50);
    await this.audit.record(req.adminId, 'admin.view.audit', 'audit', undefined, {
      count: result.length,
    });
    return result;
  }
}
