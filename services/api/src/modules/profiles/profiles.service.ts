/**
 * Profiles + preferences service (P1-03, DESIGN.md A1.9).
 * All user-data access runs under the owner's RLS context (withUser).
 * Community attribute values are validated against attribute_definitions —
 * the user self-selects; nothing is inferred (rule 10).
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createLogger } from '@saath/logger';
import { PrismaService } from '../../prisma/prisma.service';
import { SafetyService } from '../safety/safety.service';
import type {
  PatchProfileDto,
  PutDealbreakersDto,
  PutDisclosureDto,
  PutPreferencesDto,
} from './profiles.dto';

const logger = createLogger('profiles');

/** Fields on the profiles row that PATCH may set (whitelist, rule 3). */
const PROFILE_FIELDS = [
  'displayName',
  'aboutNormalised',
  'heightCm',
  'maritalStatus',
  'hasChildren',
  'diet',
  'educationLevel',
  'profession',
  'incomeBand',
  'cityId',
  'willingToRelocate',
  'religionId',
  'communityId',
  'subCommunityId',
  'motherTongue',
  'visibility',
] as const;

interface AttributeDefRow {
  key: string;
  communityScope: string | null;
  type: string;
  options: unknown;
}

/** Provenance metadata for an embedding write (P3-02, all optional). */
export interface EmbeddingProvenance {
  summaryHash?: string;
  modelVersion?: string;
  profileVersion?: number;
  prefVersion?: number;
}

const SUMMARY_HASH_PATTERN = /^[a-f0-9]{64}$/;

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SafetyService) private readonly safety: SafetyService,
  ) {}

  async getProfile(userId: string) {
    return this.prisma.withUser(userId, async (tx) => {
      const profile = await tx.profile.findUnique({ where: { userId } });
      const attributes = await tx.profileAttribute.findMany({ where: { userId } });
      return { profile, attributes };
    });
  }

  /**
   * P3-01: write the profile embedding (A2's `save_embedding` tool).
   * C2 column over the A2-normalised structured summary — never raw bio.
   * Raw SQL because the pgvector column is Unsupported in the Prisma client;
   * the literal is built only from validated finite numbers (no injection).
   * Does NOT bump profile_version: derived data, not a user edit.
   */
  async saveEmbedding(userId: string, vector: number[], meta?: EmbeddingProvenance) {
    if (vector.length !== 1024) {
      throw new BadRequestException('embedding must have exactly 1024 dimensions');
    }
    for (const x of vector) {
      if (!Number.isFinite(x) || Math.abs(x) > 1e6) {
        throw new BadRequestException('embedding values must be finite');
      }
    }
    // P3-02 provenance (all optional; validated before any DB write).
    if (meta?.summaryHash !== undefined && !SUMMARY_HASH_PATTERN.test(meta.summaryHash)) {
      throw new BadRequestException('summaryHash must be a sha256 hex digest (64 lowercase hex chars)');
    }
    if (meta?.modelVersion !== undefined && meta.modelVersion.length > 64) {
      throw new BadRequestException('modelVersion must be at most 64 characters');
    }
    for (const key of ['profileVersion', 'prefVersion'] as const) {
      const v = meta?.[key];
      if (v !== undefined && (!Number.isInteger(v) || v <= 0)) {
        throw new BadRequestException(`${key} must be a positive integer`);
      }
    }
    const literal = `[${vector.join(',')}]`;
    // Column names are hard-coded constants; only VALUES are parameters.
    // Provenance columns are written only when provided, so a bare
    // P3-01-style call (vector only) never clears existing provenance.
    const sets = [`"embedding" = '${literal}'::vector`, '"embedding_updated_at" = now()'];
    const params: unknown[] = [userId];
    if (meta?.summaryHash !== undefined) {
      params.push(meta.summaryHash);
      sets.push(`"embedding_summary_hash" = $${params.length}`);
    }
    if (meta?.modelVersion !== undefined) {
      params.push(meta.modelVersion);
      sets.push(`"embedding_model_version" = $${params.length}`);
    }
    if (meta?.profileVersion !== undefined) {
      params.push(meta.profileVersion);
      sets.push(`"embedding_profile_version" = $${params.length}`);
    }
    if (meta?.prefVersion !== undefined) {
      params.push(meta.prefVersion);
      sets.push(`"embedding_pref_version" = $${params.length}`);
    }
    return this.prisma.withUser(userId, async (tx) => {
      const rows = await tx.$executeRawUnsafe(
        `UPDATE "profiles" SET ${sets.join(', ')} WHERE "user_id" = $1::uuid`,
        ...params,
      );
      if (rows === 0) throw new NotFoundException('profile not found');
      return { ok: true as const };
    });
  }

  /**
   * P3-02: users whose stored embedding no longer matches the live profile
   * or preference versions (or who were never embedded). Runs in the
   * 'matching' service context: profiles/preferences have a generic
   * service policy (app.service non-empty), so no RLS change is needed for
   * this read. NOTE: this introduces the 'matching' GUC value; P3-03 extends
   * the users-service lookup policy for cross-user reads — not needed here
   * (no users-table read).
   */
  async listStaleEmbeddings(limit: number): Promise<string[]> {
    if (!Number.isInteger(limit) || limit <= 0 || limit > 10_000) {
      throw new BadRequestException('limit must be a positive integer (max 10000)');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      const rows = await tx.$queryRawUnsafe<Array<{ user_id: string }>>(
        `SELECT p."user_id"
           FROM "profiles" p
          WHERE p."embedding" IS NULL
             OR p."embedding_profile_version" IS DISTINCT FROM p."profile_version"
             OR p."embedding_pref_version" IS DISTINCT FROM
                (SELECT pr."version" FROM "preferences" pr
                  WHERE pr."user_id" = p."user_id")
          LIMIT $1::int`,
        limit,
      );
      return rows.map((r) => r.user_id);
    });
  }

  /**
   * Create-or-update the caller's profile; bumps profile_version on every
   * write. Provided attributes are upserted after validation.
   */
  async patchProfile(userId: string, dto: PatchProfileDto) {
    const attributes = dto.attributes ?? [];
    const data: Record<string, unknown> = {};
    for (const f of PROFILE_FIELDS) {
      if (dto[f] !== undefined) data[f] = dto[f];
    }

    let result: Awaited<ReturnType<typeof this.prisma.profile.update>>;
    try {
      result = await this.prisma.withUser(userId, async (tx) => {
        // Resolve the effective community for attribute scoping (PATCH may
        // change it in the same request).
        const existing = await tx.profile.findUnique({ where: { userId } });
        const effectiveCommunity =
          dto.communityId !== undefined ? dto.communityId : (existing?.communityId ?? null);

        if (attributes.length > 0) {
          const defs = await tx.attributeDefinition.findMany({
            where: { key: { in: attributes.map((a) => a.key) } },
          });
          const defByKey = new Map(defs.map((d) => [d.key, d as AttributeDefRow]));
          for (const attr of attributes) {
            this.validateAttribute(
              attr.key,
              attr.value,
              defByKey.get(attr.key),
              effectiveCommunity,
            );
          }
        }

        const profile = existing
          ? await tx.profile.update({
              where: { userId },
              data: { ...data, profileVersion: { increment: 1 } },
            })
          : await tx.profile.create({ data: { userId, ...data } });

        for (const attr of attributes) {
          const existingAttr = await tx.profileAttribute.findFirst({
            where: { userId, attributeKey: attr.key },
          });
          if (existingAttr) {
            await tx.profileAttribute.update({
              where: { id: existingAttr.id },
              data: { value: attr.value as object, visibility: attr.visibility },
            });
          } else {
            await tx.profileAttribute.create({
              data: {
                userId,
                attributeKey: attr.key,
                value: attr.value as object,
                visibility: attr.visibility,
              },
            });
          }
        }
        return profile;
      });
    } catch (err) {
      this.rethrowPrisma(err);
    }

    logger.info({ userId, version: result.profileVersion }, 'profile saved');
    return this.getProfile(userId);
  }

  /** FK violations (e.g. nonexistent taxonomy slug) surface as 400, not 500. */
  private rethrowPrisma(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw new BadRequestException('invalid reference value (unknown taxonomy id)');
    }
    throw err;
  }

  private validateAttribute(
    key: string,
    value: unknown,
    def: AttributeDefRow | undefined,
    communityId: string | null,
  ): void {
    if (!def) throw new BadRequestException(`unknown attribute: ${key}`);
    if (def.communityScope !== null && def.communityScope !== communityId) {
      throw new BadRequestException(`attribute ${key} does not apply to your community`);
    }
    const options = Array.isArray(def.options)
      ? (def.options as Array<{ value?: unknown }>).map((o) => o?.value)
      : [];
    switch (def.type) {
      case 'boolean':
        if (typeof value !== 'boolean')
          throw new BadRequestException(`attribute ${key} expects a boolean`);
        break;
      case 'text':
        if (typeof value !== 'string' || value.length > 500)
          throw new BadRequestException(`attribute ${key} expects a short text`);
        break;
      case 'single_select':
        if (typeof value !== 'string' || !options.includes(value))
          throw new BadRequestException(`attribute ${key} expects one of its options`);
        break;
      case 'multi_select':
        if (
          !Array.isArray(value) ||
          value.some((v) => typeof v !== 'string' || !options.includes(v))
        )
          throw new BadRequestException(`attribute ${key} expects a list of its options`);
        break;
      default:
        throw new BadRequestException(`attribute ${key} has an unsupported type`);
    }
  }

  async getPreferences(userId: string) {
    return this.prisma.withUser(userId, async (tx) => {
      const preference = await tx.preference.findUnique({ where: { userId } });
      const disclosure = await tx.disclosurePolicy.findUnique({ where: { userId } });
      const softPreferences = await tx.softPreference.findMany({ where: { userId } });
      return { preference, disclosure, softPreferences };
    });
  }

  async putPreferences(userId: string, dto: PutPreferencesDto) {
    const data: Record<string, unknown> = { ...dto };
    await this.prisma.withUser(userId, async (tx) => {
      const existing = await tx.preference.findUnique({ where: { userId } });
      if (existing) {
        await tx.preference.update({
          where: { userId },
          data: { ...data, version: { increment: 1 } },
        });
      } else {
        await tx.preference.create({ data: { userId, ...data } });
      }
    });
    logger.info({ userId }, 'preferences saved');
    return this.getPreferences(userId);
  }

  async getDealbreakers(userId: string) {
    return this.prisma.withUser(userId, (tx) => tx.dealbreaker.findMany({ where: { userId } }));
  }

  /** PUT semantics: replaces the caller's whole dealbreaker set in one tx. */
  async putDealbreakers(userId: string, dto: PutDealbreakersDto) {
    const saved = await this.prisma.withUser(userId, async (tx) => {
      const prev = await tx.dealbreaker.findMany({
        where: { userId },
        select: { version: true },
        orderBy: { version: 'desc' },
        take: 1,
      });
      const version = (prev[0]?.version ?? 0) + 1;
      await tx.dealbreaker.deleteMany({ where: { userId } });
      if (dto.dealbreakers.length > 0) {
        await tx.dealbreaker.createMany({
          data: dto.dealbreakers.map((d) => ({
            userId,
            field: d.field,
            rule: d.rule as object,
            version,
          })),
        });
      }
      return tx.dealbreaker.findMany({ where: { userId } });
    });
    logger.info({ userId, count: saved.length }, 'dealbreakers saved');
    return saved;
  }

  async putDisclosurePolicy(userId: string, dto: PutDisclosureDto) {
    await this.prisma.withUser(userId, async (tx) => {
      await tx.disclosurePolicy.upsert({
        where: { userId },
        create: { userId, shareLevel: dto.shareLevel },
        update: { shareLevel: dto.shareLevel },
      });
    });
    logger.info({ userId, shareLevel: dto.shareLevel }, 'disclosure policy saved');
    return this.getPreferences(userId);
  }

  /**
   * Cross-user profile read. Until matching ships, only the owner may read
   * (agents use service-context tool endpoints, P1-05). Existence is not
   * leaked: foreign ids get the same 404 as missing ones.
   */
  async getPublicProfile(requesterId: string, targetId: string) {
    if (requesterId !== targetId) {
      throw new NotFoundException('profile not found');
    }
    // Blocked pairs never see each other (T8). Owner-only today; P3 search and
    // P4 chat must also consult SafetyService.isBlockedEitherWay.
    if (await this.safety.isBlockedEitherWay(requesterId, targetId)) {
      throw new NotFoundException('profile not found');
    }
    const { profile } = await this.getProfile(requesterId);
    if (!profile) throw new NotFoundException('profile not found');
    return profile;
  }
}
