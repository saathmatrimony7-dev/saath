/**
 * Mock object-storage HTTP surface (P1-04). Registered ONLY when
 * STORAGE_PROVIDER=mock (cloud uses real S3 pre-signed URLs against S3 itself).
 * Auth = the HMAC signature in the URL (same bearer contract as S3 presigned
 * URLs): tampered/expired signatures get 401. No session, no user context.
 */
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { createLogger } from '@saath/logger';
import type { AppConfig } from '../../config';
import { APP_CONFIG } from '../identity/tokens';
import type { StorageProvider } from './storage-provider';
import { STORAGE_PROVIDER } from './tokens';

const logger = createLogger('storage-mock');

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

@Controller('storage-mock')
export class MockStorageController {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Put('upload')
  async upload(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    this.assertValid('PUT', key, exp, sig);
    try {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of req) {
        const buf = chunk as Buffer;
        total += buf.byteLength;
        if (total > this.config.PHOTOS_MAX_UPLOAD_BYTES) {
          throw new BadRequestException('payload exceeds size limit');
        }
        chunks.push(buf);
      }
      await this.storage.put(key, Buffer.concat(chunks));
      return { ok: true };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      logger.error({ err }, 'mock storage upload failed');
      throw err;
    }
  }

  @Get('file')
  async file(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response, // full takeover: binary body must not be JSON-serialised
  ): Promise<void> {
    this.assertValid('GET', key, exp, sig);
    const data = await this.storage.get(key);
    if (!data) throw new NotFoundException('object not found');
    const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
    res.setHeader('content-type', MIME_BY_EXT[ext] ?? 'application/octet-stream');
    res.setHeader('cache-control', 'private, max-age=60');
    res.end(data);
  }

  private assertValid(method: 'GET' | 'PUT', key: string, exp: string, sig: string): void {
    // Never serve in non-mock mode (cloud uses real S3 URLs).
    if (this.config.STORAGE_PROVIDER !== 'mock') throw new NotFoundException('not found');
    if (!key || !exp || !sig) throw new UnauthorizedException('missing signature parameters');
    if (!this.storage.verifySignature(method, key, Number(exp), sig)) {
      throw new UnauthorizedException('invalid or expired signature');
    }
  }
}
