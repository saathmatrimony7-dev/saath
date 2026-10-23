/**
 * Object storage behind an interface (P1-04). Cloud uses S3 pre-signed URLs;
 * local/test uses a disk-backed mock with the SAME signed-URL contract, so the
 * rest of the app cannot tell the difference. Files are served ONLY through
 * short-lived HMAC-signed URLs (AGENTS.md rule: no public file endpoints).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type { AppConfig } from '../../config';

export interface StorageProvider {
  /** Relative signed PUT URL the client uploads bytes to. */
  presignUpload(key: string, expiresInSec: number): string;
  /** Relative signed GET URL for serving a stored object. */
  presignGet(key: string, expiresInSec: number): string;
  /** Timing-safe signature check for presigned URLs. */
  verifySignature(method: 'GET' | 'PUT', key: string, exp: number, sig: string): boolean;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

/** HMAC-signed URL helper shared by all providers (sig binds method+key+exp). */
export function signStorageUrl(
  secret: string,
  method: 'GET' | 'PUT',
  key: string,
  exp: number,
): string {
  return createHmac('sha256', secret).update(`${method}:${key}:${exp}`).digest('base64url');
}

export function verifyStorageUrl(
  secret: string,
  method: 'GET' | 'PUT',
  key: string,
  exp: number,
  sig: string,
): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = Buffer.from(signStorageUrl(secret, method, key, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Disk-backed mock. URLs point at MockStorageController (/v1/storage-mock/*). */
export class MockStorageProvider implements StorageProvider {
  constructor(
    private readonly config: AppConfig,
    private readonly basePath: string,
  ) {}

  private pathFor(key: string): string {
    // Keys are server-generated `${uuid}/${uuid}.${ext}` — still normalise to
    // keep the mock from escaping its base directory.
    const safe = key.replace(/[^A-Za-z0-9._/-]/g, '_');
    return join(this.basePath, safe);
  }

  private url(kind: 'upload' | 'file', key: string, expiresInSec: number): string {
    const exp = Math.floor(Date.now() / 1000) + expiresInSec;
    const method = kind === 'upload' ? 'PUT' : 'GET';
    const sig = signStorageUrl(this.config.STORAGE_SIGNING_SECRET, method, key, exp);
    return `/v1/storage-mock/${kind}?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
  }

  presignUpload(key: string, expiresInSec: number): string {
    return this.url('upload', key, expiresInSec);
  }

  presignGet(key: string, expiresInSec: number): string {
    return this.url('file', key, expiresInSec);
  }

  verifySignature(method: 'GET' | 'PUT', key: string, exp: number, sig: string): boolean {
    return verifyStorageUrl(this.config.STORAGE_SIGNING_SECRET, method, key, exp, sig);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.pathFor(key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return readFileSync(this.pathFor(key));
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      unlinkSync(this.pathFor(key));
    } catch {
      /* already gone */
    }
  }
}

/** S3 stub: same contract, wired to real S3 pre-signers in P2 (with infra). */
export class S3StorageProvider implements StorageProvider {
  presignUpload(): string {
    throw new Error('S3StorageProvider lands with cloud infra (P2); use STORAGE_PROVIDER=mock');
  }
  presignGet(): string {
    throw new Error('S3StorageProvider lands with cloud infra (P2); use STORAGE_PROVIDER=mock');
  }
  verifySignature(): boolean {
    throw new Error('S3StorageProvider lands with cloud infra (P2); use STORAGE_PROVIDER=mock');
  }
  async put(): Promise<void> {
    throw new Error('S3StorageProvider lands with cloud infra (P2); use STORAGE_PROVIDER=mock');
  }
  async get(): Promise<Buffer | null> {
    throw new Error('S3StorageProvider lands with cloud infra (P2); use STORAGE_PROVIDER=mock');
  }
  async remove(): Promise<void> {
    throw new Error('S3StorageProvider lands with cloud infra (P2); use STORAGE_PROVIDER=mock');
  }
}

export function createStorageProvider(config: AppConfig): StorageProvider {
  if (config.STORAGE_PROVIDER === 's3') return new S3StorageProvider();
  const dir = isAbsolute(config.STORAGE_DIR)
    ? config.STORAGE_DIR
    : join(process.cwd(), config.STORAGE_DIR);
  return new MockStorageProvider(config, dir);
}
