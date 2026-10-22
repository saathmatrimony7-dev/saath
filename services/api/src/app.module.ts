import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MeController } from './me.controller';
import { PrismaModule } from './prisma/prisma.module';
import { IdentityModule } from './modules/identity/identity.module';

@Module({
  imports: [PrismaModule, IdentityModule],
  controllers: [HealthController, MeController],
})
export class AppModule {}
