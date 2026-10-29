/**
 * Photos service (P1-04, DESIGN.md A1.9). Flow:
 *   POST /me/photos          → row (pending) + signed PUT URL
 *   client PUTs raw bytes    → mock/S3 storage
 *   POST /me/photos/:id/complete → server re-encodes (strips EXIF/payloads,
 *                                  sharp), moderates the RE-ENCODED bytes,
 *                                  approved → signed GET URL; rejected → file
 *                                  deleted, url null, row kept as evidence.
 * Files are served ONLY via short-lived signed URLs.
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createLogger } from '@saath/logger';
import { PrismaService } from '../../prisma/prisma.service';
import { RiskScoringService } from '../safety/risk-scoring.service';
import type { AppConfig } from '../../config';
import { APP_CONFIG } from '../identity/tokens';
import type { ModerationProvider } from './moderation-provider';
import type { StorageProvider } from './storage-provider';
import { MODERATION_PROVIDER, STORAGE_PROVIDER } from './tokens';
import { extForMime, type PhotoMime, type RequestUploadDto } from './photos.dto';

const logger = createLogger('photos');

export interface PhotoView {
  id: string;
  contentType: string;
  moderationStatus: string;
  isPrimary: boolean;
  blurForNonMatches: boolean;
  url: string | null;
  createdAt: string;
}

@Injectable()
export class PhotosService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(MODERATION_PROVIDER) private readonly moderation: ModerationProvider,
    @Inject(RiskScoringService) private readonly risk: RiskScoringService,
  ) {}

  async requestUpload(userId: string, dto: RequestUploadDto) {
    if (dto.sizeBytes > this.config.PHOTOS_MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `file exceeds ${this.config.PHOTOS_MAX_UPLOAD_BYTES} byte limit`,
      );
    }
    const photoId = randomUUID();
    const key = `${userId}/${photoId}.${extForMime(dto.contentType)}`;
    const created = await this.prisma.withUser(userId, async (tx) => {
      const count = await tx.photo.count({ where: { userId } });
      if (count >= this.config.PHOTOS_MAX_COUNT) {
        throw new ConflictException(`photo limit (${this.config.PHOTOS_MAX_COUNT}) reached`);
      }
      return tx.photo.create({
        data: {
          id: photoId,
          userId,
          storageKey: key,
          contentType: dto.contentType,
          byteSize: dto.sizeBytes,
          isPrimary: count === 0,
        },
      });
    });
    const uploadUrl = this.storage.presignUpload(key, this.config.PHOTOS_URL_TTL_SEC);
    logger.info({ userId, photoId }, 'photo upload requested');
    return {
      photoId: created.id,
      uploadUrl,
      expiresAt: new Date(Date.now() + this.config.PHOTOS_URL_TTL_SEC * 1000).toISOString(),
    };
  }

  async complete(userId: string, photoId: string): Promise<PhotoView> {
    try {
      return await this.doComplete(userId, photoId);
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof ConflictException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }
      logger.error(
        { userId, photoId, errMsg: String(err), stack: (err as Error)?.stack },
        'photo completion failed',
      );
      throw err;
    }
  }

  private async doComplete(userId: string, photoId: string): Promise<PhotoView> {
    const photo = await this.prisma.withUser(userId, (tx) =>
      tx.photo.findUnique({ where: { id: photoId } }),
    );
    if (!photo || photo.userId !== userId) throw new NotFoundException('photo not found');
    if (photo.moderationStatus !== 'pending') {
      throw new ConflictException('photo already processed');
    }

    const raw = await this.storage.get(photo.storageKey);
    if (!raw) throw new BadRequestException('no upload found for this photo');
    if (raw.byteLength > this.config.PHOTOS_MAX_UPLOAD_BYTES) {
      await this.storage.remove(photo.storageKey);
      throw new BadRequestException('uploaded file exceeds size limit');
    }

    // Re-encode: normalises format and STRIPS EXIF/payloads (P1-04 exit proof).
    const clean = await this.reencode(raw, photo.contentType as PhotoMime);

    // Moderate exactly what we will serve.
    const verdict = await this.moderation.moderate(photo.storageKey, clean);

    if (!verdict.approved) {
      await this.storage.remove(photo.storageKey);
      const rejected = await this.prisma.withUser(userId, (tx) =>
        tx.photo.update({
          where: { id: photo.id },
          data: { moderationStatus: 'rejected', byteSize: 0 },
        }),
      );
      logger.warn({ userId, photoId, labels: verdict.labels }, 'photo rejected by moderation');
      return this.view(rejected, null);
    }

    await this.storage.put(photo.storageKey, clean);
    const approved = await this.prisma.withUser(userId, (tx) =>
      tx.photo.update({
        where: { id: photo.id },
        data: { moderationStatus: 'approved', byteSize: clean.byteLength },
      }),
    );
    const url = this.storage.presignGet(photo.storageKey, this.config.PHOTOS_URL_TTL_SEC);
    logger.info({ userId, photoId }, 'photo approved');
    void this.risk.recalculate(userId).catch(() => undefined); // A3 signal: pHash reuse
    return this.view(approved, url);
  }

  private async reencode(raw: Buffer, contentType: PhotoMime): Promise<Buffer> {
    try {
      const img = sharp(raw, { failOn: 'error' }).rotate(); // honour orientation, drop EXIF
      switch (contentType) {
        case 'image/png':
          return await img.png({ compressionLevel: 9 }).toBuffer();
        case 'image/webp':
          return await img.webp({ quality: 85 }).toBuffer();
        default:
          return await img.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
      }
    } catch {
      throw new BadRequestException('file is not a valid image');
    }
  }

  async list(userId: string): Promise<PhotoView[]> {
    const rows = await this.prisma.withUser(userId, (tx) =>
      tx.photo.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    );
    return rows.map((r) =>
      this.view(
        r,
        r.moderationStatus === 'approved'
          ? this.storage.presignGet(r.storageKey, this.config.PHOTOS_URL_TTL_SEC)
          : null,
      ),
    );
  }

  /** Signed GET URL for one photo. Owner only until matching ships (404 hides). */
  async getUrl(requesterId: string, photoId: string): Promise<PhotoView> {
    const photo = await this.prisma.withUser(requesterId, (tx) =>
      tx.photo.findUnique({ where: { id: photoId } }),
    );
    if (!photo || photo.userId !== requesterId) throw new NotFoundException('photo not found');
    return this.view(
      photo,
      photo.moderationStatus === 'approved'
        ? this.storage.presignGet(photo.storageKey, this.config.PHOTOS_URL_TTL_SEC)
        : null,
    );
  }

  /**
   * P3-08 feed card: the candidate's first approved photo as a short-lived
   * signed URL. Service-context read — the caller is not the owner; WHETHER
   * a card shows it is gated by the candidate's disclosure policy in the
   * matching feed (minimal share level omits it).
   */
  async getFeedPhoto(candidateId: string): Promise<{ id: string; url: string } | null> {
    const photo = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'photos', true)`;
      return tx.photo.findFirst({
        where: { userId: candidateId, moderationStatus: 'approved' },
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
    });
    if (!photo) return null;
    return {
      id: photo.id,
      url: this.storage.presignGet(photo.storageKey, this.config.PHOTOS_URL_TTL_SEC),
    };
  }

  private view(
    row: {
      id: string;
      contentType: string;
      moderationStatus: string;
      isPrimary: boolean;
      blurForNonMatches: boolean;
      createdAt: Date;
    },
    url: string | null,
  ): PhotoView {
    return {
      id: row.id,
      contentType: row.contentType,
      moderationStatus: row.moderationStatus,
      isPrimary: row.isPrimary,
      blurForNonMatches: row.blurForNonMatches,
      url,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
