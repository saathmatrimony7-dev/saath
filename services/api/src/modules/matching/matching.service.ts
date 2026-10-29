/**
 * Matching service (P3-03, DESIGN.md §8 steps 1-2 + §7.3 Stage 1):
 * deterministic eligibility + two-sided hard filters, no LLM. The same
 * evaluator powers the A6 screening broker's Stage 1 via
 * POST /v1/internal/matching/check-hard-filters.
 *
 * All user-data access runs in the transaction-local 'matching' service
 * context (RLS; the users lookup policy was extended for it in
 * 20261025221000_matching_user_lookup). Reason codes are a closed vocabulary
 * and never contain user identifiers (§7.4 rule 4: incompatible pairs are
 * never told why).
 *
 * Documented policy choices (verified against schema.prisma + profiles DTO):
 * - Age is a plain year difference (refYear - birth_year). Birth month is not
 *   stored (only birth_year), so no month adjustment is possible.
 * - Null partner values cannot disprove a requirement, EXCEPT for explicit
 *   allow-lists (cities / diet_ok / marital_ok / community filter): an unset
 *   (null) value fails those, because the list is an explicit constraint.
 *   Diet/marital null failures report DIET_UNKNOWN / MARITAL_UNKNOWN so the
 *   broker can distinguish "unset" from "mismatch".
 * - Height: a null partner height passes (unknown, soft-fail).
 * - Relocate: relocate_ok === false requires the partner to share the
 *   caller's city (null cityId on either side never counts as "same") or to
 *   be explicitly willing to relocate.
 * - community_filter shape (profiles.dto.ts putPreferencesSchema):
 *   { religions?: string[], communities?: string[] }. Applied only when
 *   openToAllCommunities === false AND the filter is set; `communities`
 *   (non-empty) constrains communityId, else `religions` constrains
 *   religionId. Nothing is ever inferred (rule 10).
 * - Dealbreakers are REQUIREMENTS on the partner (DESIGN.md §7.2 examples:
 *   partner_in [...] / partner_not_in [...]); violation fails with
 *   DEALBREAKER_<FIELD>. Unknown fields are ignored (DEALBREAKER_UNKNOWN_FIELD,
 *   never a fail). A null partner value passes (cannot disprove).
 * - "Previously passed" exclusion (P3-08): candidates the caller has
 *   `pass`ed are excluded in the pool and retrieval queries (§8 step 1
 *   "not previously passed") via the interactions table.
 *
 * P3-04 (DESIGN.md §8 steps 3-5) adds deterministic retrieval (pgvector ANN
 * cosine over the eligible pool), reciprocity re-check and a weighted pre-rank
 * (similarity / declared-field overlap / activity / verification tier), plus
 * a pure exposure-cap filter for the P3-07 caller. No LLM anywhere here.
 */
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createLogger } from '@saath/logger';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AppConfig } from '../../config';
import { APP_CONFIG } from '../identity/tokens';
import { PhotosService } from '../photos/photos.service';

const logger = createLogger('matching');

/** Closed vocabulary of hard-filter reason codes (no free text, no ids). */
export const HARD_FILTER_REASON_CODES = [
  'AGE',
  'HEIGHT',
  'CITY',
  'RELOCATE',
  'DIET',
  'DIET_UNKNOWN',
  'MARITAL',
  'MARITAL_UNKNOWN',
  'COMMUNITY',
  'DEALBREAKER_UNKNOWN_FIELD',
] as const;

/** Profile fields a dealbreaker may reference (others → unknown-field code). */
export const DEALBREAKER_FIELDS = [
  'diet',
  'marital_status',
  'has_children',
  'willing_to_relocate',
  'height_cm',
  'city_id',
  'religion_id',
  'community_id',
] as const;

/** A candidate row from the eligible pool (fields needed for stage 1 + retrieval). */
export interface PoolCandidate {
  userId: string;
  gender: string | null;
  birthYear: number | null;
  lastActiveAt: Date | null;
  heightCm: number | null;
  maritalStatus: string | null;
  hasChildren: boolean;
  diet: string | null;
  cityId: string | null;
  willingToRelocate: boolean | null;
  communityId: string | null;
  religionId: string | null;
  verificationTier: number;
}

export interface HardFilterResult {
  compatible: boolean;
  reasonCodes: string[];
}

/**
 * Typed error so callers (P3-07 / the backfill worker) can distinguish "the
 * user has no embedding yet" from other failures and trigger embedding first.
 */
export class EmbeddingMissingError extends Error {
  readonly code = 'EMBEDDING_MISSING' as const;
  constructor(userId: string) {
    super(`profile embedding missing for user ${userId}`);
    this.name = 'EmbeddingMissingError';
  }
}

/** A candidate row from the ANN retrieval (DESIGN.md §8 step 3). */
export interface RetrievedCandidate {
  userId: string;
  /** Cosine distance from the caller's embedding (pgvector `<=>`). */
  distance: number;
}

/** A pre-ranked candidate row (DESIGN.md §8 step 5). */
export interface RankedCandidate {
  userId: string;
  /** Weighted score over the four normalised components. */
  score: number;
  /** Embedding similarity in [0,1]: (1 - cosine distance) / 2. */
  similarity: number;
  /** Declared-field overlap signals (rule 10: never inferred). */
  signals: { sameCity: boolean; sameDiet: boolean; sameCommunity: boolean };
  /** Closed-vocabulary tags feeding the P3-09 explanation generator
   * (generic positives only; computed from declared fields). */
  explanationFacts: string[];
  /** Closed-vocabulary notes from the two-sided check (observability). */
  reasonCodes: string[];
}

/**
 * Closed vocabulary of P3-09 explanation fact tags. Declared fields only
 * (rule 10: never inferred); no screening verdicts/topics/reason codes ever
 * enter the bundle (§7.4 rule 3: verdict visibility follows the stricter
 * disclosure policy; explanations are generic positives only).
 */
export const EXPLANATION_FACT_TAGS = [
  'SHARED_CITY',
  'SHARED_DIET',
  'SHARED_COMMUNITY',
  'SHARED_RELIGION',
  'BOTH_VERIFIED',
  'BOTH_RECENTLY_ACTIVE',
] as const;

/**
 * Strict parser for pgvector's textual form ('[1,0.5,-2,...]') back into
 * number[]. Only bracketed, comma-separated finite numbers are accepted;
 * when `dim` is given the component count must match exactly.
 */
export function parseVectorText(text: string, dim?: number): number[] {
  const t = text.trim();
  if (t.length < 2 || !t.startsWith('[') || !t.endsWith(']')) {
    throw new Error('invalid vector text: expected [..] form');
  }
  const body = t.slice(1, -1).trim();
  const parts = body === '' ? [] : body.split(',');
  if (dim !== undefined && parts.length !== dim) {
    throw new Error(`invalid vector text: expected ${dim} components, got ${parts.length}`);
  }
  if (parts.length === 0) {
    throw new Error('invalid vector text: empty vector');
  }
  return parts.map((p, i) => {
    const x = Number(p.trim());
    if (!Number.isFinite(x)) {
      throw new Error(`invalid vector text: component ${i} is not a finite number`);
    }
    return x;
  });
}

/**
 * Activity recency bucket (DESIGN.md §8 step 5): ≤7d → 1.0, ≤30d → 0.6,
 * ≤90d → 0.3, older or unknown (null) → 0.1.
 */
export function activityScore(lastActiveAt: Date | null, now = new Date()): number {
  if (lastActiveAt == null) return 0.1;
  const days = (now.getTime() - lastActiveAt.getTime()) / 86_400_000;
  if (days <= 7) return 1.0;
  if (days <= 30) return 0.6;
  if (days <= 90) return 0.3;
  return 0.1;
}

/**
 * P3-09: pick the explanation string for the viewer's locale from the
 * stored single/multi-locale map (stored by A4 under the viewer's locale).
 */
function pickExplanation(
  map: Record<string, string> | null,
  locale: string | null,
): string | undefined {
  if (!map) return undefined;
  return map[locale ?? 'en'] ?? map['en'] ?? Object.values(map)[0];
}

type DealbreakerOp = 'eq' | 'neq' | 'in' | 'not_in' | 'lt' | 'gt';

interface ProfileSnapshot {
  heightCm: number | null;
  maritalStatus: string | null;
  hasChildren: boolean;
  diet: string | null;
  cityId: string | null;
  willingToRelocate: boolean | null;
  religionId: string | null;
  communityId: string | null;
  visibility: string;
  verificationTier: number;
}

interface SideSnapshot {
  user: { id: string; status: string; ageVerified: boolean; birthYear: number | null } | null;
  profile: ProfileSnapshot | null;
  preference: {
    ageMin: number | null;
    ageMax: number | null;
    heightMin: number | null;
    cities: string[];
    relocateOk: boolean | null;
    communityFilter: unknown;
    openToAllCommunities: boolean;
    dietOk: string[];
    maritalOk: string[];
  } | null;
  dealbreakers: { field: string; rule: { op: DealbreakerOp; value: unknown } }[];
}

const PROFILE_SELECT = {
  userId: true,
  heightCm: true,
  maritalStatus: true,
  hasChildren: true,
  diet: true,
  cityId: true,
  willingToRelocate: true,
  religionId: true,
  communityId: true,
  visibility: true,
  verificationTier: true,
} as const;

const PREFERENCE_SELECT = {
  userId: true,
  ageMin: true,
  ageMax: true,
  heightMin: true,
  cities: true,
  relocateOk: true,
  communityFilter: true,
  openToAllCommunities: true,
  dietOk: true,
  maritalOk: true,
} as const;

const DEALBREAKER_FIELD_MAP: Record<string, keyof ProfileSnapshot> = {
  diet: 'diet',
  marital_status: 'maritalStatus',
  has_children: 'hasChildren',
  willing_to_relocate: 'willingToRelocate',
  height_cm: 'heightCm',
  city_id: 'cityId',
  religion_id: 'religionId',
  community_id: 'communityId',
};

@Injectable()
export class MatchingService {
  /**
   * Per-day exposure-counts cache (P3-12, docs/p3-batch-benchmark.md). The
   * nightly batch calls shownCountsFor once per user (100k×/run); the GROUP BY
   * over daily_matches has no serving index for the batch_date-only predicate,
   * so a DB round-trip per call sequentially scans a growing table — O(n²)
   * across the run (diagnosed: 153-min 100k attempt #2). The cache is lazily
   * loaded per day, kept exact by incremental updates on publish/clear, and
   * TTL-bounded so multi-instance deployments converge (bounded staleness is
   * acceptable: the exposure cap is a best-effort fairness throttle, and the
   * per-day lazy load re-syncs on TTL expiry).
   */
  private static readonly SHOWN_COUNTS_TTL_MS = 5 * 60 * 1000;
  private readonly shownCountsCache = new Map<
    string,
    { loadedAt: number; counts: Map<string, number> }
  >();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PhotosService) private readonly photos: PhotosService,
  ) {}

  /**
   * Eligible pool for a user (DESIGN.md §8 step 1): active, age-verified,
   * verification tier ≥ 1, visibility ≠ hidden, ≥ 1 approved photo, not
   * blocked in either direction, not self, not previously `pass`ed by the
   * caller (P3-08 interactions table — §8 step 1 "not previously passed").
   * Blocks are excluded with EXISTS clauses in the pool query itself so the
   * matching module needs no safety-module dependency.
   */
  async eligiblePool(forUserId: string, opts?: { limit?: number }): Promise<PoolCandidate[]> {
    const limit = Math.min(
      opts?.limit ?? this.config.MATCHING_POOL_LIMIT,
      this.config.MATCHING_POOL_LIMIT,
    );
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ForbiddenException('invalid pool limit');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      const rows = await tx.$queryRaw<
        {
          user_id: string;
          gender: string | null;
          birth_year: number | null;
          last_active_at: Date | null;
          height_cm: number | null;
          marital_status: string | null;
          has_children: boolean;
          diet: string | null;
          city_id: string | null;
          willing_to_relocate: boolean | null;
          community_id: string | null;
          religion_id: string | null;
          verification_tier: number;
        }[]
      >`
        SELECT u."id" AS user_id, u."gender", u."birth_year", u."last_active_at",
               p."height_cm", p."marital_status", p."has_children", p."diet",
               p."city_id", p."willing_to_relocate", p."community_id",
               p."religion_id", p."verification_tier"
          FROM "users" u
          JOIN "profiles" p ON p."user_id" = u."id"
         WHERE u."status" = 'active'
           AND u."age_verified" = true
           AND p."verification_tier" >= 1
           AND p."visibility" <> 'hidden'
           AND u."id" <> ${forUserId}::uuid
           AND EXISTS (
                 SELECT 1 FROM "photos" ph
                  WHERE ph."user_id" = u."id"
                    AND ph."moderation_status" = 'approved'
               )
           AND NOT EXISTS (
                 SELECT 1 FROM "blocks" b
                  WHERE (b."blocker_id" = u."id" AND b."blocked_id" = ${forUserId}::uuid)
                     OR (b."blocker_id" = ${forUserId}::uuid AND b."blocked_id" = u."id")
               )
           AND NOT EXISTS (
                 SELECT 1 FROM "interactions" i
                  WHERE i."actor_user_id" = ${forUserId}::uuid
                    AND i."target_user_id" = u."id"
                    AND i."type" = 'pass'
               )
         ORDER BY u."last_active_at" DESC NULLS LAST
         LIMIT ${limit}::int`;
      return rows.map((r) => ({
        userId: r.user_id,
        gender: r.gender,
        birthYear: r.birth_year,
        lastActiveAt: r.last_active_at,
        heightCm: r.height_cm,
        maritalStatus: r.marital_status,
        hasChildren: r.has_children,
        diet: r.diet,
        cityId: r.city_id,
        willingToRelocate: r.willing_to_relocate,
        communityId: r.community_id,
        religionId: r.religion_id,
        verificationTier: r.verification_tier,
      }));
    });
  }

  /**
   * Retrieval (DESIGN.md §8 step 3): pgvector ANN cosine (`<=>`) over the
   * eligible pool, top `topK`. The caller's embedding is read back with
   * `embedding::text` and re-parsed with the strict parser; a null embedding
   * throws EmbeddingMissingError so the caller can trigger embedding first.
   *
   * The eligibility predicates mirror eligiblePool (status / age_verified /
   * tier / visibility / self / approved photo / blocks both directions), plus
   * `embedding IS NOT NULL`. The query vector literal is built only from
   * validated finite numbers (same rule as save_embedding). Without the HNSW
   * index this is an exact sequential scan with identical semantics.
   */
  async retrieveCandidates(
    forUserId: string,
    opts?: { topK?: number },
  ): Promise<RetrievedCandidate[]> {
    const topK = opts?.topK ?? this.config.MATCHING_RETRIEVAL_TOP_K;
    if (!Number.isInteger(topK) || topK <= 0) {
      throw new ForbiddenException('invalid retrieval topK');
    }
    // The nightly batch (P3-07) drives this with several concurrent workers
    // over the full corpus; Prisma's default 5 s interactive-transaction
    // timeout was observed expiring here (P2028) at 100k users, so allow a
    // generous timeout. The tx is read-only (set_config + SELECTs), and the
    // default 2 s maxWait for pool acquisition is also too tight under load.
    const rows = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
        const embRows = await tx.$queryRaw<{ embedding: string | null }[]>`
        SELECT p."embedding"::text AS embedding
          FROM "profiles" p
         WHERE p."user_id" = ${forUserId}::uuid`;
        const emb = embRows[0]?.embedding;
        if (emb == null) throw new EmbeddingMissingError(forUserId);
        const vector = parseVectorText(emb, 1024);
        const literal = `[${vector.join(',')}]`; // numeric-only, validated above
        return tx.$queryRawUnsafe<{ user_id: string; dist: number }[]>(
          `SELECT p."user_id" AS user_id,
                (p."embedding" <=> '${literal}'::vector)::float8 AS dist
           FROM "profiles" p
           JOIN "users" u ON u."id" = p."user_id"
          WHERE u."status" = 'active'
            AND u."age_verified" = true
            AND p."verification_tier" >= 1
            AND p."visibility" <> 'hidden'
            AND u."id" <> $1::uuid
            AND EXISTS (
                  SELECT 1 FROM "photos" ph
                   WHERE ph."user_id" = u."id"
                     AND ph."moderation_status" = 'approved'
                )
            AND NOT EXISTS (
                  SELECT 1 FROM "blocks" b
                   WHERE (b."blocker_id" = u."id" AND b."blocked_id" = $1::uuid)
                      OR (b."blocker_id" = $1::uuid AND b."blocked_id" = u."id")
                )
            AND NOT EXISTS (
                  SELECT 1 FROM "interactions" i
                   WHERE i."actor_user_id" = $1::uuid
                     AND i."target_user_id" = u."id"
                     AND i."type" = 'pass'
                )
            AND p."embedding" IS NOT NULL
          ORDER BY p."embedding" <=> '${literal}'::vector
          LIMIT $2::int`,
          forUserId,
          topK,
        );
      },
      { timeout: 60_000, maxWait: 20_000 },
    );
    return rows.map((r) => ({ userId: r.user_id, distance: r.dist }));
  }

  /**
   * Pre-rank (DESIGN.md §8 steps 4-5) — batched implementation for the
   * nightly batch (P3-07): the caller's and all candidates' snapshots are
   * loaded with four IN-queries (not 4×N) in ONE service-context
   * transaction, and the SAME deterministic two-sided evaluator runs in
   * memory. No rule drift: evaluatePair() is the same evaluator the
   * single-pair broker Stage-1 endpoint uses.
   *
   * Per-pair logging is suppressed at batch scale; one summary line per call.
   * Weights come from config; deterministic tie-break on userId.
   */
  async preRankCandidates(
    forUserId: string,
    retrieved: RetrievedCandidate[],
    opts?: { topN?: number },
  ): Promise<RankedCandidate[]> {
    const topN = opts?.topN ?? this.config.MATCHING_PRERANK_TOP_N;
    if (!Number.isInteger(topN) || topN <= 0) {
      throw new ForbiddenException('invalid pre-rank topN');
    }
    const w = this.preRankWeights();
    if (retrieved.length === 0) return [];

    const ids = retrieved.map((r) => r.userId);
    const { me, sides } = await this.loadSidesForBatch(forUserId, ids);
    if (!me.user || !me.profile) return [];

    const ranked: RankedCandidate[] = [];
    for (const r of retrieved) {
      // Step 4 — reciprocity: drop when the two-sided check fails.
      const cand = sides.get(r.userId);
      if (!cand || !cand.user || !cand.profile) continue;
      const check = this.evaluatePair(me, cand, { quiet: true });
      if (!check.compatible) continue;
      const prof = cand.profile;

      const signals = {
        sameCity: me.profile!.cityId != null && me.profile!.cityId === prof.cityId,
        sameDiet: me.profile!.diet != null && me.profile!.diet === prof.diet,
        sameCommunity:
          (me.profile!.communityId != null && me.profile!.communityId === prof.communityId) ||
          (me.profile!.religionId != null && me.profile!.religionId === prof.religionId),
      };
      const rule =
        (signals.sameCity ? 1 : 0) + (signals.sameDiet ? 1 : 0) + (signals.sameCommunity ? 1 : 0);
      const similarity = Math.max(0, Math.min(1, (1 - r.distance) / 2));
      const score =
        w.similarity * similarity +
        w.rule * (rule / 3) +
        w.activity * activityScore(cand.userLastActiveAt ?? null) +
        w.verification * (prof.verificationTier / 3);
      ranked.push({
        userId: r.userId,
        score,
        similarity,
        signals,
        explanationFacts: this.explanationFacts(me, cand),
        reasonCodes: check.reasonCodes,
      });
    }
    ranked.sort((a, b) => b.score - a.score || (a.userId < b.userId ? -1 : 1));
    logger.info(
      { forUserId, retrieved: retrieved.length, ranked: ranked.length },
      'batch pre-rank complete',
    );
    return ranked.slice(0, topN);
  }

  /**
   * Loads the caller side + all candidate sides in one 'matching'
   * service-context transaction using four IN-queries total. The nightly
   * batch's hot path (per-user cost stays flat as top-K grows).
   */
  private async loadSidesForBatch(forUserId: string, candidateIds: string[]) {
    type LoadedSide = SideSnapshot & { userLastActiveAt: Date | null };
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      const ids = [forUserId, ...candidateIds];
      const users = await tx.user.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          status: true,
          ageVerified: true,
          birthYear: true,
          lastActiveAt: true,
        },
      });
      const profiles = await tx.profile.findMany({
        where: { userId: { in: ids } },
        select: PROFILE_SELECT,
      });
      const preferences = await tx.preference.findMany({
        where: { userId: { in: ids } },
        select: PREFERENCE_SELECT,
      });
      const dealbreakerRows = await tx.dealbreaker.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, field: true, rule: true },
      });
      const userById = new Map(users.map((u) => [u.id, u]));
      const profileById = new Map(profiles.map((pr) => [pr.userId, pr]));
      const prefById = new Map(preferences.map((pf) => [pf.userId, pf]));
      const dbById = new Map<string, { field: string; rule: unknown }[]>();
      for (const d of dealbreakerRows) {
        const list = dbById.get(d.userId) ?? [];
        list.push(d);
        dbById.set(d.userId, list);
      }
      const build = (id: string): LoadedSide => {
        const user = userById.get(id) ?? null;
        return {
          user: user
            ? {
                id: user.id,
                status: user.status,
                ageVerified: user.ageVerified,
                birthYear: user.birthYear,
              }
            : null,
          userLastActiveAt: user?.lastActiveAt ?? null,
          profile: profileById.get(id) ?? null,
          preference: prefById.get(id) ?? null,
          dealbreakers: (dbById.get(id) ?? []).map((d) => ({
            field: d.field,
            rule: d.rule as { op: DealbreakerOp; value: unknown },
          })),
        };
      };
      const me = build(forUserId);
      const sides = new Map<string, LoadedSide>();
      for (const id of candidateIds) sides.set(id, build(id));
      return { me, sides };
    });
  }

  /** Steps 3-5 in one call: ANN retrieval → reciprocity → weighted pre-rank. */
  async rankCandidates(
    forUserId: string,
    opts?: { topK?: number; topN?: number },
  ): Promise<RankedCandidate[]> {
    const retrieved = await this.retrieveCandidates(forUserId, { topK: opts?.topK });
    return this.preRankCandidates(forUserId, retrieved, { topN: opts?.topN });
  }

  /**
   * Exposure cap (DESIGN.md §8 step 8) as a pure function: keeps candidates
   * whose shown-count is below the cap. The P3-07 caller supplies
   * shownCounts (e.g. from daily_matches); an empty map is a no-op.
   */
  applyExposureCap<T extends { userId: string }>(
    candidates: T[],
    shownCounts: ReadonlyMap<string, number>,
    cap?: number,
  ): T[] {
    const c = cap ?? this.config.MATCHING_EXPOSURE_DAILY_CAP;
    if (!Number.isInteger(c) || c <= 0) {
      throw new ForbiddenException('invalid exposure cap');
    }
    return candidates.filter((cand) => (shownCounts.get(cand.userId) ?? 0) < c);
  }

  /** Validates the four pre-rank weights (positive finite numbers) when used. */
  private preRankWeights() {
    const w = {
      similarity: this.config.MATCHING_WEIGHT_SIMILARITY,
      rule: this.config.MATCHING_WEIGHT_RULE,
      activity: this.config.MATCHING_WEIGHT_ACTIVITY,
      verification: this.config.MATCHING_WEIGHT_VERIFICATION,
    };
    for (const [key, value] of Object.entries(w)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new ForbiddenException(`invalid matching weight: ${key}`);
      }
    }
    return w;
  }

  /**
   * P3-09: closed-vocabulary fact tags for the explanation generator.
   * Declared fields only, both sides; never screening content. Computed
   * from snapshots the pre-rank already loaded (no extra queries).
   */
  private explanationFacts(
    me: SideSnapshot & { userLastActiveAt: Date | null },
    cand: SideSnapshot & { userLastActiveAt: Date | null },
  ): string[] {
    const facts: string[] = [];
    const myProfile = me.profile!;
    const theirProfile = cand.profile!;
    if (myProfile.cityId != null && myProfile.cityId === theirProfile.cityId) {
      facts.push('SHARED_CITY');
    }
    if (myProfile.diet != null && myProfile.diet === theirProfile.diet) {
      facts.push('SHARED_DIET');
    }
    if (myProfile.communityId != null && myProfile.communityId === theirProfile.communityId) {
      facts.push('SHARED_COMMUNITY');
    } else if (myProfile.religionId != null && myProfile.religionId === theirProfile.religionId) {
      facts.push('SHARED_RELIGION');
    }
    if (myProfile.verificationTier >= 2 && theirProfile.verificationTier >= 2) {
      facts.push('BOTH_VERIFIED');
    }
    const weekAgo = Date.now() - 7 * 86_400_000;
    if (
      (me.userLastActiveAt?.getTime() ?? 0) >= weekAgo &&
      (cand.userLastActiveAt?.getTime() ?? 0) >= weekAgo
    ) {
      facts.push('BOTH_RECENTLY_ACTIVE');
    }
    return facts;
  }

  /**
   * P3-09: disclosure gate for serving explanations (§7.4 rule 3 — the
   * stricter of the two users' disclosure policies). Order:
   * minimal < standard < detailed.
   */
  private stricterShareLevel(a: string | null, b: string | null): string {
    const order: Record<string, number> = { minimal: 0, standard: 1, detailed: 2 };
    const ra = order[a ?? 'standard'] ?? 1;
    const rb = order[b ?? 'standard'] ?? 1;
    // Unknown levels rank as 'standard'; ties resolve to a (same rank anyway).
    return ra <= rb ? (a ?? 'standard') : (b ?? 'standard');
  }

  /**
   * Two-sided hard filter check (DESIGN.md §7.3 Stage 1 / §8 step 2):
   * A's preferences + dealbreakers vs B's profile, and symmetrically.
   * Foreign or unknown ids are indistinguishable from missing ones (404),
   * matching the codebase-wide convention.
   */
  async hardFilterCheck(aUserId: string, bUserId: string): Promise<HardFilterResult> {
    const pair = await this.loadPair(aUserId, bUserId);
    if (!pair.a.user || !pair.b.user || !pair.a.profile || !pair.b.profile) {
      throw new NotFoundException('pair not found');
    }
    return this.evaluatePair(pair.a, pair.b);
  }

  /**
   * Internal gate for later surfaces (messaging/match actions): both users
   * must be pool-eligible and pass the two-sided hard filters. Throws
   * ForbiddenException carrying only closed-vocabulary reason codes.
   */
  async assertEligiblePair(aUserId: string, bUserId: string): Promise<void> {
    const pair = await this.loadPair(aUserId, bUserId);
    if (!pair.a.user || !pair.b.user || !pair.a.profile || !pair.b.profile) {
      throw new NotFoundException('pair not found');
    }
    const reasons: string[] = [];
    if (aUserId === bUserId) reasons.push('SELF');
    for (const [side, snap] of [
      ['A', pair.a],
      ['B', pair.b],
    ] as const) {
      if (!this.isEligibleSnapshot(snap)) reasons.push(`INELIGIBLE_${side}`);
    }
    if (await this.isBlockedInMatchingContext(aUserId, bUserId)) reasons.push('BLOCKED');
    if (reasons.length === 0) {
      const check = this.evaluatePair(pair.a, pair.b);
      if (!check.compatible) reasons.push(...check.reasonCodes);
    }
    if (reasons.length > 0) {
      throw new ForbiddenException({ message: 'pair is not eligible', reasons });
    }
  }

  /**
   * INTERNAL (P3-07)
   * ------------------------------------------------------------------------
   */

  /**
   * Step 1 enumeration for the nightly batch: every user eligible to RECEIVE
   * a feed (same predicates as the eligible pool minus the per-caller block
   * exclusion, which is applied per candidate later). The batch runner
   * chunks this list; entitlement differences (Free 1/wk vs paid 3-5/day)
   * are config/P4 — every eligible user gets one publish per batch_date.
   */
  async listBatchUserIds(): Promise<string[]> {
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      return tx.$queryRaw<{ user_id: string }[]>`
        SELECT u."id" AS user_id
          FROM "users" u
          JOIN "profiles" p ON p."user_id" = u."id"
         WHERE u."status" = 'active'
           AND u."age_verified" = true
           AND p."verification_tier" >= 1
           AND p."visibility" <> 'hidden'
           AND EXISTS (
                 SELECT 1 FROM "photos" ph
                  WHERE ph."user_id" = u."id"
                    AND ph."moderation_status" = 'approved'
               )
         ORDER BY u."last_active_at" DESC NULLS LAST, u."id"`;
    });
    return rows.map((r) => r.user_id);
  }

  /**
   * Step 8 input: how many times each candidate has already been published
   * on a batch date (across all users). The A4 caller applies the exposure
   * cap as a pure filter (P3-04's applyExposureCap).
   */
  async shownCountsFor(batchDate: Date): Promise<Map<string, number>> {
    const day = batchDate.toISOString().slice(0, 10);
    const nowMs = Date.now();
    // Opportunistic sweep so long-past days do not accumulate forever.
    for (const [key, entry] of this.shownCountsCache) {
      if (nowMs - entry.loadedAt >= MatchingService.SHOWN_COUNTS_TTL_MS) {
        this.shownCountsCache.delete(key);
      }
    }
    const cached = this.shownCountsCache.get(day);
    if (cached) return cached.counts;
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      return tx.$queryRaw<{ candidate_id: string; n: number }[]>`
        SELECT "candidate_id", count(*)::int AS n
          FROM "daily_matches"
         WHERE "batch_date" = ${day}::date
         GROUP BY "candidate_id"`;
    });
    const counts = new Map(rows.map((r) => [r.candidate_id, Number(r.n)]));
    this.shownCountsCache.set(day, { loadedAt: nowMs, counts });
    return counts;
  }

  /**
   * Keep a loaded per-day cache exact when a user's rows for that day change.
   * No-op when the day is not cached (the next lazy load sees the committed
   * rows). Runs after the write tx commits, so the cache never exposes
   * uncommitted state.
   */
  private bumpShownCounts(batchDate: Date, removed: string[], added: string[]): void {
    const entry = this.shownCountsCache.get(batchDate.toISOString().slice(0, 10));
    if (!entry) return;
    for (const id of removed) {
      const n = (entry.counts.get(id) ?? 0) - 1;
      if (n <= 0) entry.counts.delete(id);
      else entry.counts.set(id, n);
    }
    for (const id of added) {
      entry.counts.set(id, (entry.counts.get(id) ?? 0) + 1);
    }
  }

  /** P3-09: the user's locale (explanations are generated viewer-locale-side). */
  async getUserLocale(userId: string): Promise<string> {
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      return tx.user.findUnique({ where: { id: userId }, select: { locale: true } });
    });
    return row?.locale ?? 'en';
  }

  /**
   * Step 9 publish: replace-set semantics per (user, batch_date) — re-running
   * the batch for the same date is idempotent and removes stale rows. Ranks
   * must be unique and >= 1; at most MATCHING_DAILY_PUBLISH_COUNT rows.
   */
  async publishDailyMatches(
    userId: string,
    batchDate: Date,
    matches: {
      candidateId: string;
      rank: number;
      score: number;
      explanation?: Record<string, string>;
    }[],
  ): Promise<{ published: number }> {
    const max = this.config.MATCHING_DAILY_PUBLISH_COUNT;
    if (!Number.isInteger(max) || max <= 0) {
      throw new ForbiddenException('invalid daily publish count');
    }
    if (matches.length === 0) {
      await this.clearDailyMatches(userId, batchDate);
      return { published: 0 };
    }
    if (matches.length > max) {
      throw new ForbiddenException(`daily publish count exceeds ${max}`);
    }
    const ranks = matches.map((m) => m.rank);
    if (ranks.some((r) => !Number.isInteger(r) || r < 1) || new Set(ranks).size !== ranks.length) {
      throw new ForbiddenException('ranks must be unique integers >= 1');
    }
    const day = batchDate.toISOString().slice(0, 10);
    const removed = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      // Replace-set: capture the user's current candidates first so the
      // per-day shown-counts cache (P3-12) can be kept exact incrementally.
      const prev = await tx.$queryRaw<{ candidate_id: string }[]>`
        SELECT "candidate_id" FROM "daily_matches"
         WHERE "user_id" = ${userId}::uuid AND "batch_date" = ${day}::date`;
      await tx.$executeRaw`DELETE FROM "daily_matches" WHERE "user_id" = ${userId}::uuid AND "batch_date" = ${day}::date`;
      await tx.dailyMatch.createMany({
        // P3-09: A4's explanation (already schema-validated by the tool DTO).
        // Omitted → SQL NULL (replace-set re-publish clears stale text).
        data: matches.map((m) => ({
          userId,
          candidateId: m.candidateId,
          batchDate: new Date(`${day}T00:00:00Z`),
          rank: m.rank,
          status: 'published',
          ...(m.explanation ? { explanationI18n: m.explanation as Prisma.InputJsonValue } : {}),
        })),
      });
      return prev.map((r) => r.candidate_id);
    });
    this.bumpShownCounts(
      batchDate,
      removed,
      matches.map((m) => m.candidateId),
    );
    logger.info({ userId, batchDate: day, published: matches.length }, 'daily matches published');
    return { published: matches.length };
  }

  /** Idempotent-re-run helper: clears a user's rows for a batch date. */
  async clearDailyMatches(userId: string, batchDate: Date): Promise<void> {
    const day = batchDate.toISOString().slice(0, 10);
    const removed = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      const prev = await tx.$queryRaw<{ candidate_id: string }[]>`
        SELECT "candidate_id" FROM "daily_matches"
         WHERE "user_id" = ${userId}::uuid AND "batch_date" = ${day}::date`;
      await tx.$executeRaw`DELETE FROM "daily_matches" WHERE "user_id" = ${userId}::uuid AND "batch_date" = ${day}::date`;
      return prev.map((r) => r.candidate_id);
    });
    this.bumpShownCounts(batchDate, removed, []);
  }

  /**
   * P3-08 feed/interaction plumbing. `id` in /v1/matches/:id/* is a
   * daily_matches row; foreign ids are indistinguishable from missing ones
   * (404), matching the codebase-wide no-existence-leak convention.
   */
  async getOwnedMatchOr404(userId: string, matchId: string) {
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      return tx.dailyMatch.findUnique({ where: { id: matchId } });
    });
    if (!row || row.userId !== userId) throw new NotFoundException('match not found');
    return row;
  }

  /** P3-08: like/pass mark the caller's feed row 'acted' (idempotent). */
  async markActed(userId: string, matchId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      await tx.$executeRaw`UPDATE "daily_matches" SET "status" = 'acted', "updated_at" = now()
                            WHERE "id" = ${matchId}::uuid AND "user_id" = ${userId}::uuid AND "status" <> 'acted'`;
    });
  }

  /**
   * Daily feed (P3-08, DESIGN.md §8 step-8 consumer surface): the caller's
   * rows for today, re-gated LIVE — a row is hidden when the candidate is no
   * longer eligible (status / age_verified / tier / visibility), either
   * direction is blocked, the caller has `pass`ed them, or a non-expired
   * screening verdict is INCOMPATIBLE. Fetching the feed marks published
   * rows 'viewed'. Cards are disclosure-gated by the CANDIDATE's
   * share_level: 'minimal' omits photo / religion / community (the photo URL
   * comes from PhotosService; matching never touches the photos table).
   */
  async getFeed(userId: string) {
    const day = new Date().toISOString().slice(0, 10);
    const nowYear = new Date().getFullYear();
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      await tx.$executeRaw`UPDATE "daily_matches" SET "status" = 'viewed', "updated_at" = now()
                            WHERE "user_id" = ${userId}::uuid AND "batch_date" = ${day}::date AND "status" = 'published'`;
      const matches = await tx.$queryRaw<
        {
          match_id: string;
          candidate_id: string;
          rank: number;
          status: string;
          birth_year: number | null;
          height_cm: number | null;
          marital_status: string | null;
          diet: string | null;
          city_id: string | null;
          religion_id: string | null;
          community_id: string | null;
          verification_tier: number;
          candidate_share_level: string | null;
          viewer_share_level: string | null;
          viewer_locale: string | null;
          explanation_i18n: Record<string, string> | null;
        }[]
      >`
        SELECT dm."id" AS match_id, dm."candidate_id", dm."rank", dm."status",
               u."birth_year", p."height_cm", p."marital_status", p."diet",
               p."city_id", p."religion_id", p."community_id", p."verification_tier",
               dp."share_level" AS candidate_share_level,
               dpv."share_level" AS viewer_share_level,
               uv."locale" AS viewer_locale,
               dm."explanation_i18n" AS explanation_i18n
          FROM "daily_matches" dm
          JOIN "users" u ON u."id" = dm."candidate_id"
          JOIN "users" uv ON uv."id" = dm."user_id"
          JOIN "profiles" p ON p."user_id" = dm."candidate_id"
          LEFT JOIN "disclosure_policies" dp ON dp."user_id" = dm."candidate_id"
          LEFT JOIN "disclosure_policies" dpv ON dpv."user_id" = dm."user_id"
         WHERE dm."user_id" = ${userId}::uuid
           AND dm."batch_date" = ${day}::date
           AND u."status" = 'active'
           AND u."age_verified" = true
           AND p."verification_tier" >= 1
           AND p."visibility" <> 'hidden'
           AND NOT EXISTS (
                 SELECT 1 FROM "blocks" b
                  WHERE (b."blocker_id" = dm."candidate_id" AND b."blocked_id" = ${userId}::uuid)
                     OR (b."blocker_id" = ${userId}::uuid AND b."blocked_id" = dm."candidate_id")
               )
           AND NOT EXISTS (
                 SELECT 1 FROM "interactions" i
                  WHERE i."actor_user_id" = ${userId}::uuid
                    AND i."target_user_id" = dm."candidate_id"
                    AND i."type" = 'pass'
               )
           AND NOT EXISTS (
                 SELECT 1 FROM "screening_results" sr
                  WHERE ((sr."user_a" = ${userId}::uuid AND sr."user_b" = dm."candidate_id")
                      OR (sr."user_a" = dm."candidate_id" AND sr."user_b" = ${userId}::uuid))
                    AND sr."verdict" = 'INCOMPATIBLE'
                    AND sr."expires_at" > now()
               )
         ORDER BY dm."rank" ASC`;

      // Taxonomy labels for the cards (reference tables, read in the same
      // service context so no RLS surprises).
      const ids = (sel: (r: (typeof matches)[number]) => string | null) => [
        ...new Set(matches.map(sel).filter((v): v is string => v !== null)),
      ];
      const [cities, religions, communities] = await Promise.all([
        tx.taxonomyCity.findMany({
          where: { id: { in: ids((r) => r.city_id) } },
          select: { id: true, labelI18n: true },
        }),
        tx.taxonomyReligion.findMany({
          where: { id: { in: ids((r) => r.religion_id) } },
          select: { id: true, labelI18n: true },
        }),
        tx.taxonomyCommunity.findMany({
          where: { id: { in: ids((r) => r.community_id) } },
          select: { id: true, labelI18n: true },
        }),
      ]);
      const label = (rows: { id: string; labelI18n: unknown }[], id: string | null) => {
        const row = id == null ? undefined : rows.find((x) => x.id === id);
        return row ? { id: row.id, labels: row.labelI18n } : null;
      };
      return matches.map((r) => ({
        ...r,
        city: label(cities, r.city_id),
        religion: label(religions, r.religion_id),
        community: label(communities, r.community_id),
      }));
    });

    // Photo enrichment: one short-lived signed URL per card (≤ ~5 cards).
    return Promise.all(
      rows.map(async (r) => {
        const minimal = r.candidate_share_level === 'minimal';
        const photo = minimal ? null : await this.photos.getFeedPhoto(r.candidate_id);
        // P3-09: explanations follow the STRICTER of the two disclosure
        // policies (§7.4 rule 3) — either side at 'minimal' hides them.
        const explanation =
          this.stricterShareLevel(r.viewer_share_level, r.candidate_share_level) !== 'minimal'
            ? pickExplanation(r.explanation_i18n, r.viewer_locale)
            : undefined;
        const base = {
          matchId: r.match_id,
          candidateId: r.candidate_id,
          rank: r.rank,
          status: r.status,
          age: r.birth_year == null ? null : nowYear - r.birth_year,
          city: r.city,
          diet: r.diet,
          maritalStatus: r.marital_status,
          heightCm: r.height_cm,
          verificationTier: r.verification_tier,
        };
        const full = explanation
          ? { ...base, explanation, religion: r.religion, community: r.community, photo }
          : { ...base, religion: r.religion, community: r.community, photo };
        return minimal ? base : full;
      }),
    );
  }

  /**
   * P3-10 Family Mode: the owner's shortlisted candidates as disclosure-
   * gated cards (§6 A7 tool get_family_view). Same eligibility/block gates
   * as the feed; the candidate's share_level drives the projection
   * ('minimal' → base fields only). The family module calls this AFTER its
   * own authz (membership + family_mode consent); matching trusts callers.
   */
  async getShortlistCards(ownerId: string) {
    const nowYear = new Date().getFullYear();
    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      const items = await tx.$queryRaw<
        {
          interaction_id: string;
          candidate_id: string;
          shortlisted_at: Date;
          birth_year: number | null;
          height_cm: number | null;
          marital_status: string | null;
          diet: string | null;
          city_id: string | null;
          religion_id: string | null;
          community_id: string | null;
          verification_tier: number;
          candidate_share_level: string | null;
        }[]
      >`
        SELECT i."id" AS interaction_id, i."target_user_id" AS candidate_id,
               i."created_at" AS shortlisted_at,
               u."birth_year", p."height_cm", p."marital_status", p."diet",
               p."city_id", p."religion_id", p."community_id", p."verification_tier",
               dp."share_level" AS candidate_share_level
          FROM "interactions" i
          JOIN "users" u ON u."id" = i."target_user_id"
          JOIN "profiles" p ON p."user_id" = i."target_user_id"
          LEFT JOIN "disclosure_policies" dp ON dp."user_id" = i."target_user_id"
         WHERE i."actor_user_id" = ${ownerId}::uuid
           AND i."type" = 'shortlist'
           AND u."status" = 'active'
           AND u."age_verified" = true
           AND p."verification_tier" >= 1
           AND p."visibility" <> 'hidden'
           AND NOT EXISTS (
                 SELECT 1 FROM "blocks" b
                  WHERE (b."blocker_id" = i."target_user_id" AND b."blocked_id" = ${ownerId}::uuid)
                     OR (b."blocker_id" = ${ownerId}::uuid AND b."blocked_id" = i."target_user_id")
               )
         ORDER BY i."created_at" DESC`;

      const ids = (sel: (r: (typeof items)[number]) => string | null) => [
        ...new Set(items.map(sel).filter((v): v is string => v !== null)),
      ];
      const [cities, religions, communities] = await Promise.all([
        tx.taxonomyCity.findMany({
          where: { id: { in: ids((r) => r.city_id) } },
          select: { id: true, labelI18n: true },
        }),
        tx.taxonomyReligion.findMany({
          where: { id: { in: ids((r) => r.religion_id) } },
          select: { id: true, labelI18n: true },
        }),
        tx.taxonomyCommunity.findMany({
          where: { id: { in: ids((r) => r.community_id) } },
          select: { id: true, labelI18n: true },
        }),
      ]);
      const label = (ls: { id: string; labelI18n: unknown }[], id: string | null) => {
        const row = id == null ? undefined : ls.find((x) => x.id === id);
        return row ? { id: row.id, labels: row.labelI18n } : null;
      };
      return items.map((r) => ({
        ...r,
        city: label(cities, r.city_id),
        religion: label(religions, r.religion_id),
        community: label(communities, r.community_id),
      }));
    });

    return Promise.all(
      rows.map(async (r) => {
        const minimal = r.candidate_share_level === 'minimal';
        const base = {
          interactionId: r.interaction_id,
          candidateId: r.candidate_id,
          shortlistedAt: r.shortlisted_at,
          age: r.birth_year == null ? null : nowYear - r.birth_year,
          city: r.city,
          diet: r.diet,
          maritalStatus: r.marital_status,
          heightCm: r.height_cm,
          verificationTier: r.verification_tier,
        };
        if (minimal) return base;
        const photo = await this.photos.getFeedPhoto(r.candidate_id);
        return { ...base, religion: r.religion, community: r.community, photo };
      }),
    );
  }

  /** Loads both sides of the pair in one 'matching' service-context transaction. */
  private async loadPair(aUserId: string, bUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      const load = async (id: string): Promise<SideSnapshot> => {
        const user = await tx.user.findUnique({
          where: { id },
          select: { id: true, status: true, ageVerified: true, birthYear: true },
        });
        const profile = await tx.profile.findUnique({
          where: { userId: id },
          select: PROFILE_SELECT,
        });
        const preference = await tx.preference.findUnique({
          where: { userId: id },
          select: PREFERENCE_SELECT,
        });
        const dealbreakers = await tx.dealbreaker.findMany({
          where: { userId: id },
          select: { field: true, rule: true },
        });
        return {
          user,
          profile,
          preference,
          dealbreakers: dealbreakers.map((d) => ({
            field: d.field,
            rule: d.rule as { op: DealbreakerOp; value: unknown },
          })),
        };
      };
      return { a: await load(aUserId), b: await load(bUserId) };
    });
  }

  private isEligibleSnapshot(s: SideSnapshot): boolean {
    return (
      s.user !== null &&
      s.user.status === 'active' &&
      s.user.ageVerified &&
      s.profile !== null &&
      s.profile.verificationTier >= 1 &&
      s.profile.visibility !== 'hidden'
    );
  }

  private async isBlockedInMatchingContext(a: string, b: string): Promise<boolean> {
    if (a === b) return false;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      const row = await tx.block.findFirst({
        where: {
          OR: [
            { blockerId: a, blockedId: b },
            { blockerId: b, blockedId: a },
          ],
        },
      });
      return row !== null;
    });
  }

  /** Deterministic evaluation in both directions; closed-vocabulary codes. */
  private evaluatePair(
    a: SideSnapshot,
    b: SideSnapshot,
    opts?: { quiet?: boolean },
  ): HardFilterResult {
    const fails = new Set<string>();
    const notes = new Set<string>();
    this.checkDirection(a, b, fails, notes);
    this.checkDirection(b, a, fails, notes);
    if (!opts?.quiet) {
      logger.info(
        { a: a.user?.id, b: b.user?.id, compatible: fails.size === 0, codes: [...fails] },
        'hard filter check',
      );
    }
    return { compatible: fails.size === 0, reasonCodes: [...fails, ...notes] };
  }

  /** A's preferences + dealbreakers vs B's profile. Adds reason codes on violation. */
  private checkDirection(
    a: SideSnapshot,
    b: SideSnapshot,
    codes: Set<string>,
    notes: Set<string>,
  ): void {
    const bp = b.profile;
    const bu = b.user;
    if (!bp || !bu) return; // caller guarantees presence; nothing to disprove
    const p = a.preference;

    if (p) {
      // Age (simple year difference — birth month is not stored).
      const ageB = bu.birthYear != null ? new Date().getFullYear() - bu.birthYear : null;
      if (ageB !== null) {
        if (p.ageMin != null && ageB < p.ageMin) codes.add('AGE');
        if (p.ageMax != null && ageB > p.ageMax) codes.add('AGE');
      }

      // Height: null partner height passes (unknown).
      if (p.heightMin != null && bp.heightCm != null && bp.heightCm < p.heightMin) {
        codes.add('HEIGHT');
      }

      // Cities: an explicit list fails a null city (cannot satisfy an allow-list).
      if (p.cities.length > 0) {
        if (bp.cityId == null || !p.cities.includes(bp.cityId)) codes.add('CITY');
      }

      // Relocation: caller refuses to relocate → partner must share the caller's
      // city or be explicitly willing to relocate.
      if (p.relocateOk === false) {
        const sameCity =
          a.profile !== null && a.profile.cityId != null && a.profile.cityId === bp.cityId;
        if (!sameCity && bp.willingToRelocate !== true) codes.add('RELOCATE');
      }

      // Explicit enum allow-lists fail closed on null values (documented above).
      if (p.dietOk.length > 0) {
        if (bp.diet == null) codes.add('DIET_UNKNOWN');
        else if (!p.dietOk.includes(bp.diet)) codes.add('DIET');
      }
      if (p.maritalOk.length > 0) {
        if (bp.maritalStatus == null) codes.add('MARITAL_UNKNOWN');
        else if (!p.maritalOk.includes(bp.maritalStatus)) codes.add('MARITAL');
      }

      // Community filter: only when set AND openToAllCommunities is false.
      if (p.openToAllCommunities === false && p.communityFilter) {
        const f = p.communityFilter as { religions?: unknown; communities?: unknown };
        const communities = Array.isArray(f.communities) ? (f.communities as string[]) : [];
        const religions = Array.isArray(f.religions) ? (f.religions as string[]) : [];
        if (communities.length > 0) {
          if (bp.communityId == null || !communities.includes(bp.communityId)) {
            codes.add('COMMUNITY');
          }
        } else if (religions.length > 0) {
          if (bp.religionId == null || !religions.includes(bp.religionId)) codes.add('COMMUNITY');
        }
      }
    }

    // A's dealbreakers are requirements on B's profile — evaluated even when
    // A has no preferences row (a preference row is not a prerequisite).
    for (const d of a.dealbreakers) {
      this.applyDealbreaker(d, bp, codes, notes);
    }
  }

  /**
   * Requirement semantics (DESIGN.md §7.2): `eq` = partner must equal,
   * `neq` = must differ, `in`/`not_in` = membership required/forbidden,
   * `lt`/`gt` = partner value must be below/above the bound. Numeric compare
   * when both sides are numeric, else string equality.
   */
  private applyDealbreaker(
    d: { field: string; rule: { op: DealbreakerOp; value: unknown } },
    bp: ProfileSnapshot,
    codes: Set<string>,
    notes: Set<string>,
  ): void {
    const key = DEALBREAKER_FIELD_MAP[d.field];
    if (!key) {
      notes.add('DEALBREAKER_UNKNOWN_FIELD'); // ignore the rule, never fail
      return;
    }
    const fieldValue: unknown = bp[key];
    if (fieldValue == null) return; // cannot disprove a requirement
    const { op, value } = d.rule;
    const code = `DEALBREAKER_${d.field.toUpperCase()}`;
    const eq = (x: unknown, y: unknown): boolean =>
      typeof x === 'number' && typeof y === 'number' ? x === y : String(x) === String(y);
    switch (op) {
      case 'eq':
        if (!eq(fieldValue, value)) codes.add(code);
        break;
      case 'neq':
        if (eq(fieldValue, value)) codes.add(code);
        break;
      case 'in':
        if (!Array.isArray(value) || !value.some((v) => eq(fieldValue, v))) codes.add(code);
        break;
      case 'not_in':
        if (Array.isArray(value) && value.some((v) => eq(fieldValue, v))) codes.add(code);
        break;
      case 'lt':
        if (typeof fieldValue === 'number' && typeof value === 'number' && !(fieldValue < value)) {
          codes.add(code);
        }
        break;
      case 'gt':
        if (typeof fieldValue === 'number' && typeof value === 'number' && !(fieldValue > value)) {
          codes.add(code);
        }
        break;
    }
  }
}
