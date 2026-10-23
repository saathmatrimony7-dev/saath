/**
 * Photos tests (P1-04):
 * - happy path: request → signed PUT → re-encode strips EXIF/payloads →
 *   moderation → approved → signed GET serves the CLEAN bytes
 * - mock-moderation rejection: file deleted, url null, never visible
 * - MIME allowlist + size cap + per-user count cap (config-driven)
 * - signed URLs: tampered/expired signature → 401
 * - authz: anonymous 401, no-CSRF 403, foreign photo 404, RLS zero rows
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { bootTestApp, signupTestUser, TestClient, type TestApp } from '../helpers/test-app';
import { getTestDbUrls } from '../helpers/test-db';
import { RlsPrismaClient } from '../../src/prisma/rls-prisma.client';
import { MODERATION_PROVIDER, STORAGE_PROVIDER } from '../../src/modules/photos/tokens';
import type { MockModerationProvider } from '../../src/modules/photos/moderation-provider';
import type { StorageProvider } from '../../src/modules/photos/storage-provider';

process.env.PHOTOS_MAX_COUNT = '3';
const storageDir = mkdtempSync(join(tmpdir(), 'saath-photos-'));
process.env.STORAGE_DIR = storageDir;

let t: TestApp;
let client: TestClient;
let userId: string;
let other: TestClient;

interface PhotoView {
  id: string;
  moderationStatus: string;
  isPrimary: boolean;
  blurForNonMatches: boolean;
  url: string | null;
}

async function makeJpegWithMarker(): Promise<Buffer> {
  const raw = await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 90, g: 120, b: 200 } },
  })
    .jpeg()
    .toBuffer();
  // Insert a COM segment (FF FE) carrying an Exif marker just before EOI (FF D9).
  // Valid JPEG structure — survives decoders, must NOT survive re-encode.
  const marker = Buffer.from('Exif\0\0mock-exif-payload');
  const com = Buffer.alloc(4 + marker.length);
  com.writeUInt16BE(0xfffe, 0);
  com.writeUInt16BE(marker.length + 2, 2);
  marker.copy(com, 4);
  return Buffer.concat([raw.subarray(0, raw.length - 2), com, raw.subarray(raw.length - 2)]);
}

async function requestPhoto(c: TestClient, contentType = 'image/jpeg', sizeBytes = 5000) {
  const res = await c.req('POST', '/v1/me/photos', { contentType, sizeBytes }, c.csrfHeaders());
  return res;
}

async function putBytes(uploadUrl: string, body: Buffer): Promise<Response> {
  return fetch(`${t.baseUrl}${uploadUrl}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body,
  });
}

beforeAll(async () => {
  t = await bootTestApp();
  ({ client, userId } = await signupTestUser(t, '+919100000301'));
  other = (await signupTestUser(t, '+919100000302')).client;
});

afterAll(async () => {
  await t.app.close();
  rmSync(storageDir, { recursive: true, force: true });
});

describe('photo upload pipeline', () => {
  let approvedPhoto: PhotoView;

  it('full flow: upload → EXIF stripped → approved → signed GET serves clean bytes', async () => {
    const req = await requestPhoto(client);
    expect(req.status).toBe(201);
    const { photoId, uploadUrl } = req.json as unknown as {
      photoId: string;
      uploadUrl: string;
    };
    expect(uploadUrl).toContain('/v1/storage-mock/upload?key=');

    const dirty = await makeJpegWithMarker();
    expect(dirty.includes(Buffer.from('Exif\0\0'))).toBe(true);
    const put = await putBytes(uploadUrl, dirty);
    expect(put.status).toBe(200);

    const done = await client.req(
      'POST',
      `/v1/me/photos/${photoId}/complete`,
      undefined,
      client.csrfHeaders(),
    );
    expect(done.status).toBe(200);
    approvedPhoto = done.json as unknown as PhotoView;
    expect(approvedPhoto.moderationStatus).toBe('approved');
    expect(approvedPhoto.isPrimary).toBe(true);
    expect(approvedPhoto.blurForNonMatches).toBe(true);
    expect(approvedPhoto.url).toContain('/v1/storage-mock/file?key=');

    // Served bytes are the RE-ENCODED image: no EXIF marker, valid, same size.
    const served = await fetch(`${t.baseUrl}${approvedPhoto.url}`);
    expect(served.status).toBe(200);
    const servedBytes = Buffer.from(await served.arrayBuffer());
    expect(servedBytes.includes(Buffer.from('Exif\0\0'))).toBe(false);
    const meta = await sharp(servedBytes).metadata();
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(48);
  });

  it('complete twice is rejected', async () => {
    const res = await client.req(
      'POST',
      `/v1/me/photos/${approvedPhoto.id}/complete`,
      undefined,
      client.csrfHeaders(),
    );
    expect(res.status).toBe(409);
  });

  it('mock-moderation rejection: file deleted, url null, still not visible', async () => {
    const req = await requestPhoto(client);
    const { photoId, uploadUrl } = req.json as unknown as { photoId: string; uploadUrl: string };
    const key = `${userId}/${photoId}.jpg`;
    t.app.get<MockModerationProvider>(MODERATION_PROVIDER).report(key);

    await putBytes(uploadUrl, await makeJpegWithMarker());
    const done = await client.req(
      'POST',
      `/v1/me/photos/${photoId}/complete`,
      undefined,
      client.csrfHeaders(),
    );
    expect(done.status).toBe(200);
    const view = done.json as unknown as PhotoView;
    expect(view.moderationStatus).toBe('rejected');
    expect(view.url).toBeNull();

    // File gone from storage; URL endpoint reports url null.
    const storage = t.app.get<StorageProvider>(STORAGE_PROVIDER);
    expect(await storage.get(key)).toBeNull();
    const urlRes = await client.get(`/v1/photos/${photoId}/url`);
    expect(urlRes.status).toBe(200);
    expect((urlRes.json as unknown as PhotoView).url).toBeNull();
  });

  it('rejects non-image bytes at complete time', async () => {
    const req = await requestPhoto(client);
    const { photoId, uploadUrl } = req.json as unknown as { photoId: string; uploadUrl: string };
    await putBytes(uploadUrl, Buffer.from('definitely not a jpeg'));
    const done = await client.req(
      'POST',
      `/v1/me/photos/${photoId}/complete`,
      undefined,
      client.csrfHeaders(),
    );
    expect(done.status).toBe(400);
  });

  it('enforces per-user photo count cap', async () => {
    const res = await requestPhoto(client);
    expect(res.status).toBe(409); // 3 already exist (approved, rejected, pending)
  });

  it('rejects disallowed MIME and oversized declarations', async () => {
    expect((await requestPhoto(client, 'image/gif')).status).toBe(400);
    expect((await requestPhoto(other, 'image/jpeg', 10_485_761)).status).toBe(400);
    const strict = await other.req(
      'POST',
      '/v1/me/photos',
      { contentType: 'image/jpeg', sizeBytes: 100, extra: 1 },
      other.csrfHeaders(),
    );
    expect(strict.status).toBe(400);
  });
});

describe('signed URL security', () => {
  it('tampered or expired signatures are 401', async () => {
    const req = await requestPhoto(other);
    const { uploadUrl } = req.json as unknown as { uploadUrl: string };
    const tampered = uploadUrl.replace(/sig=[^&]+/, 'sig=AAAA');
    expect((await putBytes(tampered, Buffer.from('x'))).status).toBe(401);

    const expired = uploadUrl.replace(/exp=\d+/, 'exp=1');
    expect((await putBytes(expired, Buffer.from('x'))).status).toBe(401);
  });
});

describe('authz', () => {
  let photoId: string;

  it('setup: other user has an approved photo', async () => {
    const req = await requestPhoto(other);
    ({ photoId } = req.json as unknown as { photoId: string });
    await putBytes((req.json as unknown as { uploadUrl: string }).uploadUrl, await makeJpegWithMarker());
    const done = await other.req(
      'POST',
      `/v1/me/photos/${photoId}/complete`,
      undefined,
      other.csrfHeaders(),
    );
    expect(done.status).toBe(200);
  });

  it('anonymous 401; mutating without CSRF 403; foreign photo 404', async () => {
    const anon = new TestClient(t.baseUrl);
    expect((await anon.get('/v1/me/photos')).status).toBe(401);
    expect((await anon.req('POST', '/v1/me/photos', { contentType: 'image/jpeg', sizeBytes: 1 })).status).toBe(401);
    expect((await client.req('POST', '/v1/me/photos', { contentType: 'image/jpeg', sizeBytes: 1 })).status).toBe(403);
    expect((await client.get(`/v1/photos/${photoId}/url`)).status).toBe(404);
    expect((await anon.get(`/v1/photos/${photoId}/url`)).status).toBe(401);
  });

  it('RLS: foreign direct row read gets zero rows', async () => {
    const appDb = new RlsPrismaClient({ datasources: { db: { url: getTestDbUrls().appUrl } } });
    const rows = await appDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${'00000000-0000-0000-0000-000000000000'}, true)`;
      return tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n
        FROM photos WHERE id = ${photoId}::uuid`;
    });
    expect(Number(rows[0]?.n ?? 0)).toBe(0);
    await appDb.$disconnect();
  });
});
