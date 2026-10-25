import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IdentityModule } from '../identity/identity.module';
import { SafetyService } from './safety.service';
import { UsersSafetyController, MeBlocksController } from './safety.controller';

@Module({
  imports: [IdentityModule, PrismaModule],
  controllers: [UsersSafetyController, MeBlocksController],
  providers: [SafetyService],
  exports: [SafetyService],
})
export class SafetyModule {}
