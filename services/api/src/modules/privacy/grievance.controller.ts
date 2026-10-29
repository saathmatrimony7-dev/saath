/**
 * Grievance-officer queue (P5-01, DESIGN.md §2.2 IT Intermediary Rules):
 *   GET  /v1/admin/grievances           — open grievances by SLA (breached first)
 *   POST /v1/admin/grievances/:id/decide — resolve/dismiss with a resolution note
 * Staff-only (AdminGuard: admin/superadmin role or an active JIT elevation);
 * every decision is audit-logged (ids only, no grievance text).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AdminGuard, type AdminRequest } from '../admin/admin.guard';
import { AuditService } from '../admin/audit.service';
import { PrivacyService } from './privacy.service';
import type { Request } from 'express';

const decideSchema = z
  .object({
    resolution: z.string().min(1).max(400),
  })
  .strict();

@Controller('admin/grievances')
@UseGuards(AdminGuard)
export class GrievanceController {
  constructor(
    @Inject(PrivacyService) private readonly privacy: PrivacyService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  queue() {
    return this.privacy.grievanceQueue();
  }

  @Post(':id/decide')
  @HttpCode(HttpStatus.OK)
  async decide(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decideSchema)) body: z.infer<typeof decideSchema>,
  ) {
    const adminId = (req as AdminRequest).adminId;
    const result = await this.privacy.resolveGrievance(id, body.resolution, adminId);
    await this.audit.record(adminId, 'admin.action.grievance_decide', 'grievance', id, {
      status: result.status,
    });
    return result;
  }
}
