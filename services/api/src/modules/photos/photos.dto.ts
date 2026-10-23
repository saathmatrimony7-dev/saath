/**
 * Photos DTOs (P1-04). Strict (rule 3). MIME allowlist + size cap are config,
 * not hard-coded limits in the handler.
 */
import { z } from 'zod';

export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoMime = (typeof PHOTO_MIME_TYPES)[number];

const mimeExt: Record<PhotoMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function extForMime(mime: string): string | null {
  return (mimeExt as Record<string, string>)[mime] ?? null;
}

export const requestUploadSchema = z
  .object({
    contentType: z.enum(PHOTO_MIME_TYPES),
    sizeBytes: z.number().int().positive(),
  })
  .strict();

export type RequestUploadDto = z.infer<typeof requestUploadSchema>;
