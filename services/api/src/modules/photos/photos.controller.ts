/**
 * Photos endpoints (P1-04):
 *   POST /v1/me/photos              — create row + signed PUT URL
 *   POST /v1/me/photos/:id/complete — re-encode + moderate, returns signed GET URL
 *   GET  /v1/me/photos              — own photos with fresh signed URLs
 *   GET  /v1/photos/:id/url         — one signed GET URL (owner only for now)
 * Authenticated; mutating routes CSRF-guarded.
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
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthGuard, CsrfGuard, CurrentUser } from '../identity/guards';
import { PhotosService } from './photos.service';
import { requestUploadSchema, type RequestUploadDto } from './photos.dto';

@Controller('me/photos')
@UseGuards(AuthGuard)
export class MePhotosController {
  constructor(@Inject(PhotosService) private readonly photos: PhotosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  requestUpload(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(requestUploadSchema)) body: RequestUploadDto,
  ) {
    return this.photos.requestUpload(userId, body);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  complete(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) photoId: string) {
    return this.photos.complete(userId, photoId);
  }

  @Get()
  list(@CurrentUser() userId: string) {
    return this.photos.list(userId);
  }
}

@Controller('photos')
@UseGuards(AuthGuard)
export class PhotoUrlController {
  constructor(@Inject(PhotosService) private readonly photos: PhotosService) {}

  @Get(':id/url')
  getUrl(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) photoId: string) {
    return this.photos.getUrl(userId, photoId);
  }
}
