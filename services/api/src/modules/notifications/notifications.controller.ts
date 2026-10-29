/**
 * Notifications (P4-05, DESIGN.md §14):
 *   GET  /v1/notifications            — owner feed (cursor: ?before=<id>)
 *   POST /v1/notifications/:id/read
 *   GET  /v1/notifications/settings
 *   PUT  /v1/notifications/settings
 * Authenticated (AuthGuard); mutating routes are CSRF-guarded.
 */
import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthGuard, CsrfGuard, CurrentUser } from '../identity/guards';
import { NotificationsService } from './notifications.service';

const settingsSchema = z
  .object({
    quietStartMin: z.number().int().min(0).max(1439),
    quietEndMin: z.number().int().min(0).max(1439),
    dailyCap: z.number().int().min(1).max(100),
    channels: z.object({ inapp: z.boolean(), whatsapp: z.boolean() }).strict(),
  })
  .strict();

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  @Get()
  list(
    @CurrentUser() userId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    return this.notifications.list(userId, undefined, limit);
  }

  @Post(':id/read')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  async markRead(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) notificationId: string,
  ): Promise<{ read: true }> {
    await this.notifications.markRead(userId, notificationId);
    return { read: true };
  }

  @Get('settings')
  getSettings(@CurrentUser() userId: string) {
    return this.notifications.getSettings(userId);
  }

  @Put('settings')
  @UseGuards(CsrfGuard)
  putSettings(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(settingsSchema)) body: z.infer<typeof settingsSchema>,
  ) {
    return this.notifications.putSettings(userId, body);
  }
}
