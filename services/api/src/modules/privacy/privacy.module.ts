import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminModule } from '../admin/admin.module';
import { PrivacyController } from './privacy.controller';
import { GrievanceController } from './grievance.controller';
import { PrivacyService } from './privacy.service';

@Module({
  imports: [IdentityModule, PrismaModule, AdminModule],
  controllers: [PrivacyController, GrievanceController],
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
