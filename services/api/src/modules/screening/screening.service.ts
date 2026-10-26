/**
 * Screening service (P3-05, DESIGN.md §7): the Core half of the A5/A6
 * broker protocol.
 *
 *  - Redacted snapshot builder: enums + A2-normalised stances ONLY, strict
 *    zod schema (screening.dto.ts). No raw user text can enter — the builder
 *    selects no free-text column (no about, no transcript, no name).
 *  - Audit hashing (§7.4.6): every snapshot gets a sha256 over its canonical
 *    JSON; the verdict's inputs_hash binds both snapshot hashes to the
 *    pinned rules version. write_screening_result re-verifies all three so a
 *    verdict can never be pinned to inputs the broker did not actually use
 *    (a preference change mid-flight forces a 409 + re-screen).
 *  - Verdict cache: one row per normalised pair, keyed by both preference
 *    versions; any preference change is a miss (§7.4.5).
 *
 * All user-data access runs in the transaction-local 'screening' service
 * context (RLS); the preferences-family tables' generic service policies
 * cover it — no users-table read is needed here (existence is proven by the
 * profile/preference rows; foreign ids 404 like everywhere else).
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createLogger } from '@saath/logger';
import { PrismaService } from '../../prisma/prisma.service';
import type { AppConfig } from '../../config';
import { APP_CONFIG } from '../identity/tokens';
import {
  redactedSnapshotSchema,
  type RedactedSnapshot,
  type WriteScreeningResultDto,
  STANCE_MAX_CHARS,
} from './screening.dto';

const logger = createLogger('screening');

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function snapshotHash(snapshot: RedactedSnapshot): string {
  return sha256Hex(canonicalJson(snapshot));
}

/** Binds the two snapshot hashes to the pinned rules version (§7.4.6). */
export function inputsHash(snapshotHashA: string, snapshotHashB: string, rulesVersion: string): string {
  return sha256Hex(`${snapshotHashA}|${snapshotHashB}|${rulesVersion}`);
}

/** One canonical order for a pair: lexicographic by uuid string. */
export function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export interface SnapshotBundle {
  snapshot: RedactedSnapshot;
  hash: string;
}

export type FindCachedResult =
  | { status: 'hit'; result: unknown }
  | {
      status: 'miss';
      prefVersionA: number;
      prefVersionB: number;
      rulesVersion: string;
      modelVersion: string;
    };

@Injectable()
export class ScreeningService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Builds the redacted snapshot for one user. Returns null when the user
   * has no profile/preference row (404 discipline — indistinguishable from
   * a missing user). Stances over the 200-char bound are dropped, not
   * truncated: a malformed A2 output must never reach an advocate.
   */
  async buildSnapshot(userId: string): Promise<SnapshotBundle | null> {
    const built = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'screening', true)`;
      const profile = await tx.profile.findUnique({
        where: { userId },
        select: {
          profileVersion: true,
          diet: true,
          maritalStatus: true,
          hasChildren: true,
          willingToRelocate: true,
        },
      });
      const preference = await tx.preference.findUnique({
        where: { userId },
        select: { version: true, relocateOk: true, dietOk: true, maritalOk: true },
      });
      if (!profile || !preference) return null;
      const softRows = await tx.softPreference.findMany({
        where: { userId },
        select: { topic: true, stanceNormalised: true, weight: true },
      });
      const disclosure = await tx.disclosurePolicy.findUnique({
        where: { userId },
        select: { shareLevel: true },
      });
      return { profile, preference, softRows, shareLevel: disclosure?.shareLevel ?? 'standard' };
    });
    if (!built) return null;

    const raw = {
      userId,
      prefVersion: built.preference.version,
      profileVersion: built.profile.profileVersion,
      profileEnums: {
        diet: built.profile.diet,
        maritalStatus: built.profile.maritalStatus,
        hasChildren: built.profile.hasChildren,
        willingToRelocate: built.profile.willingToRelocate,
      },
      preferences: {
        relocateOk: built.preference.relocateOk,
        dietOk: built.preference.dietOk,
        maritalOk: built.preference.maritalOk,
      },
      softPreferences: built.softRows
        .filter(
          (r) =>
            r.topic.length > 0 &&
            r.stanceNormalised.length >= 1 &&
            r.stanceNormalised.length <= STANCE_MAX_CHARS,
        )
        .map((r) => ({ topic: r.topic, stance: r.stanceNormalised, weight: r.weight })),
      shareLevel: built.shareLevel,
    };
    // The builder must always produce a schema-valid snapshot; the parse is
    // the proof (invalid enum in the DB fails closed here, 500, never leaks).
    const snapshot = redactedSnapshotSchema.parse(raw);
    return { snapshot, hash: snapshotHash(snapshot) };
  }

  /** A6 tool get_preference_snapshot. */
  async getPreferenceSnapshot(userId: string) {
    const bundle = await this.buildSnapshot(userId);
    if (!bundle) throw new NotFoundException('preference snapshot not found');
    return {
      snapshot: bundle.snapshot,
      snapshotHash: bundle.hash,
      prefVersion: bundle.snapshot.prefVersion,
      profileVersion: bundle.snapshot.profileVersion,
      rulesVersion: this.config.SCREENING_RULES_VERSION,
      modelVersion: this.config.SCREENING_MODEL_VERSION,
    };
  }

  /**
   * Cache lookup (§7.4.5): hit only when the stored preference versions of
   * BOTH sides still match the database and the verdict has not expired.
   */
  async findCached(aUserId: string, bUserId: string): Promise<FindCachedResult> {
    const [userA, userB] = normalizePair(aUserId, bUserId);
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'screening', true)`;
      const prefA = await tx.preference.findUnique({ where: { userId: userA }, select: { version: true } });
      const prefB = await tx.preference.findUnique({ where: { userId: userB }, select: { version: true } });
      if (!prefA || !prefB) throw new NotFoundException('pair not found');
      const cached = await tx.screeningResult.findUnique({ where: { userA_userB: { userA, userB } } });
      return { prefA, prefB, cached };
    });
    if (
      row.cached &&
      row.cached.prefVersionA === row.prefA.version &&
      row.cached.prefVersionB === row.prefB.version &&
      row.cached.expiresAt.getTime() > Date.now()
    ) {
      return { status: 'hit', result: row.cached };
    }
    return {
      status: 'miss',
      prefVersionA: row.prefA.version,
      prefVersionB: row.prefB.version,
      rulesVersion: this.config.SCREENING_RULES_VERSION,
      modelVersion: this.config.SCREENING_MODEL_VERSION,
    };
  }

  /**
   * A6 tool write_screening_result. Validates the verdict against the
   * pinned model version, the closed reason-code vocabulary (zod) and the
   * audit-hash chain, then upserts the pair's cache row. Preference versions
   * are taken from freshly built snapshots — the client cannot claim them.
   */
  async writeResult(dto: WriteScreeningResultDto) {
    if (dto.modelVersion !== this.config.SCREENING_MODEL_VERSION) {
      throw new BadRequestException(
        `model_version must be pinned to ${this.config.SCREENING_MODEL_VERSION}`,
      );
    }
    const [userA, userB] = normalizePair(dto.pair[0], dto.pair[1]);
    const bundleA = await this.buildSnapshot(userA);
    const bundleB = await this.buildSnapshot(userB);
    if (!bundleA || !bundleB) throw new NotFoundException('pair not found');
    if (dto.snapshotHashA !== bundleA.hash || dto.snapshotHashB !== bundleB.hash) {
      throw new ConflictException('snapshot hash mismatch — inputs changed, re-screen required');
    }
    const expected = inputsHash(bundleA.hash, bundleB.hash, this.config.SCREENING_RULES_VERSION);
    if (dto.inputsHash !== expected) {
      throw new ConflictException('inputs_hash mismatch — recomputed from canonical snapshots');
    }

    const expiresAt = new Date(
      Date.now() + this.config.SCREENING_RESULT_TTL_DAYS * 86_400_000,
    );
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'screening', true)`;
      return tx.screeningResult.upsert({
        where: { userA_userB: { userA, userB } },
        create: {
          userA,
          userB,
          prefVersionA: bundleA.snapshot.prefVersion,
          prefVersionB: bundleB.snapshot.prefVersion,
          verdict: dto.verdict,
          score: dto.score,
          topics: dto.topics,
          reasonCodes: dto.reasonCodes,
          modelVersion: dto.modelVersion,
          inputsHash: dto.inputsHash,
          expiresAt,
        },
        update: {
          prefVersionA: bundleA.snapshot.prefVersion,
          prefVersionB: bundleB.snapshot.prefVersion,
          verdict: dto.verdict,
          score: dto.score,
          topics: dto.topics,
          reasonCodes: dto.reasonCodes,
          modelVersion: dto.modelVersion,
          inputsHash: dto.inputsHash,
          expiresAt,
        },
      });
    });
    logger.info(
      {
        userA,
        userB,
        verdict: dto.verdict,
        score: dto.score,
        codes: dto.reasonCodes,
        modelVersion: dto.modelVersion,
      },
      'screening result written',
    );
    return row;
  }
}
