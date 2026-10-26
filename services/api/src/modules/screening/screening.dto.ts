/**
 * Screening DTOs (P3-05, DESIGN.md §7): the redacted preference snapshot and
 * the verdict write. These schemas are the Core half of the A5/A6 contract;
 * services/agents/schemas/screening.py mirrors them. Everything is strict
 * (unknown keys rejected) and every string is either a closed enum or a
 * bounded, system-normalised stance — no free-text field exists anywhere in
 * the snapshot (exit criterion 1).
 */
import { z } from 'zod';
import { HARD_FILTER_REASON_CODES } from '../matching/matching.service';
import { DIET_VALUES, MARITAL_STATUSES, SHARE_LEVELS } from '../profiles/profiles.dto';

/** A2-normalised stance: the ONLY natural-language channel, bounded + written
 * by the system (A2), never raw user text (DESIGN.md §7.4 rule 1). */
export const STANCE_MAX_CHARS = 200;
export const TOPIC_MAX_CHARS = 64;

export const softPreferenceSchema = z
  .object({
    topic: z.string().min(1).max(TOPIC_MAX_CHARS),
    stance: z.string().min(1).max(STANCE_MAX_CHARS),
    weight: z.number().int().min(0).max(100),
  })
  .strict();

/**
 * The redacted view A5 advocates receive about the OTHER side (and that Core
 * hands to the broker for the pair). Enums + normalised stances ONLY:
 * no names, no about text, no transcript, no community/religion (Stage 1
 * handles community deterministically; nothing inferred, rule 10), no city
 * (location is a Stage-1 concern; precise city is unnecessary cross-user data).
 */
export const redactedSnapshotSchema = z
  .object({
    userId: z.string().uuid(),
    prefVersion: z.number().int().min(1),
    profileVersion: z.number().int().min(1),
    profileEnums: z
      .object({
        diet: z.enum(DIET_VALUES).nullable(),
        maritalStatus: z.enum(MARITAL_STATUSES).nullable(),
        hasChildren: z.boolean(),
        willingToRelocate: z.boolean().nullable(),
      })
      .strict(),
    preferences: z
      .object({
        relocateOk: z.boolean().nullable(),
        dietOk: z.array(z.enum(DIET_VALUES)).max(10),
        maritalOk: z.array(z.enum(MARITAL_STATUSES)).max(10),
      })
      .strict(),
    softPreferences: z.array(softPreferenceSchema).max(10),
    shareLevel: z.enum(SHARE_LEVELS),
  })
  .strict();

export type RedactedSnapshot = z.infer<typeof redactedSnapshotSchema>;

export const TOPIC_RESULTS = ['compatible', 'partial', 'conflict'] as const;

export const topicScoreSchema = z
  .object({
    topic: z.string().min(1).max(TOPIC_MAX_CHARS),
    result: z.enum(TOPIC_RESULTS),
  })
  .strict();

/** Stage-1 codes (matching module, single source of truth) + Stage-2/3 codes. */
export const SCREENING_REASON_CODES = [
  ...HARD_FILTER_REASON_CODES,
  'SOFT_TOPIC_PARTIAL',
  'SOFT_TOPIC_CONFLICT',
] as const;

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'expected sha256 hex');

export const verdictSchema = z.enum(['COMPATIBLE', 'PARTIAL', 'INCOMPATIBLE']);

/** Body of the A6 write_screening_result tool. */
export const writeScreeningResultSchema = z
  .object({
    pair: z.tuple([z.string().uuid(), z.string().uuid()]),
    verdict: verdictSchema,
    score: z.number().min(0).max(1),
    topics: z.array(topicScoreSchema).max(64),
    reasonCodes: z
      .array(z.string().max(64))
      .max(20)
      .refine(
        (codes) => codes.every((c) => (SCREENING_REASON_CODES as readonly string[]).includes(c)),
        { message: 'reason code outside the closed vocabulary' },
      ),
    modelVersion: z.string().min(1).max(32),
    inputsHash: sha256Hex,
    snapshotHashA: sha256Hex,
    snapshotHashB: sha256Hex,
  })
  .strict();

export type WriteScreeningResultDto = z.infer<typeof writeScreeningResultSchema>;

export const getPreferenceSnapshotSchema = z
  .object({ userId: z.string().uuid() })
  .strict();

export const findCachedSchema = z
  .object({ aUserId: z.string().uuid(), bUserId: z.string().uuid() })
  .strict();
