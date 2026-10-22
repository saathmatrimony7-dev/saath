import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from './modules/identity/guards';
import { PrismaService } from './prisma/prisma.service';

/**
 * Minimal authenticated probe for P0: proves the JWT guard, the RLS
 * per-request user context, and the authorisation test harness end to end.
 */
@Controller('me')
export class MeController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  @UseGuards(AuthGuard)
  async me(@CurrentUser() userId: string) {
    // RLS: this read runs under app.current_user_id = the caller's id.
    const user = await this.prisma.withUser(userId, (tx) =>
      tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, locale: true, status: true, ageVerified: true },
      }),
    );
    return user;
  }
}
