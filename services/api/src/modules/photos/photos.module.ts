import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { SafetyModule } from '../safety/safety.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { APP_CONFIG } from '../identity/tokens';
import type { AppConfig } from '../../config';
import { MePhotosController, PhotoUrlController } from './photos.controller';
import { MockStorageController } from './mock-storage.controller';
import { PhotosService } from './photos.service';
import { MockModerationProvider } from './moderation-provider';
import { createStorageProvider } from './storage-provider';
import { MODERATION_PROVIDER, STORAGE_PROVIDER } from './tokens';
import type { StorageProvider } from './storage-provider';

@Module({
  imports: [IdentityModule, PrismaModule, SafetyModule],
  controllers: [MePhotosController, PhotoUrlController, MockStorageController],
  providers: [
    {
      provide: STORAGE_PROVIDER,
      useFactory: (config: AppConfig): StorageProvider => createStorageProvider(config),
      inject: [APP_CONFIG], // exported by IdentityModule
    },
    {
      provide: MODERATION_PROVIDER,
      useFactory: () => new MockModerationProvider(),
    },
    PhotosService,
  ],
  exports: [PhotosService],
})
export class PhotosModule {}
