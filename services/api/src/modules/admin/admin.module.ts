import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IdentityModule } from '../identity/identity.module';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { AuditService } from './audit.service';
import { AdminController, AdminJitController } from './admin.controller';

@Module({
  imports: [IdentityModule, PrismaModule],
  controllers: [AdminController, AdminJitController],
  providers: [AdminGuard, AdminService, AuditService],
  exports: [AdminService, AuditService],
})
export class AdminModule {}
