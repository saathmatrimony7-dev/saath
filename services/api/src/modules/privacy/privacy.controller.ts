/**
 * DPDP self-serve surface (P5-01, DESIGN.md §10.2 + §11 privacy):
 *   POST   /v1/me/export        — data export (access right), synchronous JSON
 *   DELETE /v1/me               — account deletion (erasure; the sweeper
 *                                 finishes after the retention window)
 *   POST   /v1/me/grievances    — { category, details } (C4-encrypted at rest)
 *   GET    /v1/me/grievances    — own requests + SLA status
 * Authenticated (AuthGuard); mutating routes are CSRF-guarded. The
 * grievance-officer queue lives in grievance.controller.ts (staff).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthGuard, CsrfGuard, CurrentUser } from '../identity/guards';
import { PrivacyService } from './privacy.service';

const grievanceSchema = z
  .object({
    category: z.string().min(1).max(64),
    details: z.string().min(1).max(2000),
  })
  .strict();

@Controller('me')
@UseGuards(AuthGuard)
export class PrivacyController {
  constructor(@Inject(PrivacyService) private readonly privacy: PrivacyService) {}

  @Post('export')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  export(@CurrentUser() userId: string) {
    return this.privacy.exportUserData(userId);
  }

  @Delete()
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  async erase(@CurrentUser() userId: string) {
    const dsr = await this.privacy.requestErasure(userId);
    return { requested: true, dsr };
  }

  @Post('grievances')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  fileGrievance(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(grievanceSchema)) body: z.infer<typeof grievanceSchema>,
  ) {
    return this.privacy.fileGrievance(userId, body.category, body.details);
  }

  @Get('grievances')
  listMine(@CurrentUser() userId: string) {
    return this.privacy.listMine(userId);
  }
}
