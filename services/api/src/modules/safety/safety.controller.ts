/**
 * Safety endpoints (P2-03):
 *   POST   /v1/users/:id/report   — file a report (CSRF)
 *   PUT    /v1/users/:id/block    — block (CSRF, idempotent)
 *   DELETE /v1/users/:id/block    — unblock (CSRF, idempotent)
 *   GET    /v1/me/blocks          — own block list
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthGuard, CsrfGuard, CurrentUser } from '../identity/guards';
import { SafetyService } from './safety.service';
import { RiskScoringService } from './risk-scoring.service';
import { reportUserSchema, type ReportUserDto } from './safety.dto';

@Controller('users')
@UseGuards(AuthGuard)
export class UsersSafetyController {
  constructor(@Inject(SafetyService) private readonly safety: SafetyService) {}

  @Post(':id/report')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  report(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) targetId: string,
    @Body(new ZodValidationPipe(reportUserSchema)) dto: ReportUserDto,
  ) {
    return this.safety.report(userId, targetId, dto);
  }

  @Put(':id/block')
  @UseGuards(CsrfGuard)
  block(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) targetId: string) {
    return this.safety.block(userId, targetId);
  }

  @Delete(':id/block')
  @UseGuards(CsrfGuard)
  unblock(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) targetId: string) {
    return this.safety.unblock(userId, targetId);
  }
}

@Controller('me/blocks')
@UseGuards(AuthGuard)
export class MeBlocksController {
  constructor(@Inject(SafetyService) private readonly safety: SafetyService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.safety.listBlocks(userId);
  }
}

@Controller('me/risk')
@UseGuards(AuthGuard)
export class MeRiskController {
  constructor(@Inject(RiskScoringService) private readonly risk: RiskScoringService) {}

  @Get()
  own(@CurrentUser() userId: string) {
    return this.risk.getOwnRisk(userId);
  }
}
