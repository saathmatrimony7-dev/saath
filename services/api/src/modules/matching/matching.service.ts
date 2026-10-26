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
 * - "Previously passed" exclusion: the interactions table lands in P3-08 —
 *   the pool query carries a TODO and no filter for it yet.
 */
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createLogger } from '@saath/logger';
import { PrismaService } from '../../prisma/prisma.service';
import type { AppConfig } from '../../config';
import { APP_CONFIG } from '../identity/tokens';

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
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Eligible pool for a user (DESIGN.md §8 step 1): active, age-verified,
   * verification tier ≥ 1, visibility ≠ hidden, ≥ 1 approved photo, not
   * blocked in either direction, not self. Blocks are excluded with EXISTS
   * clauses in the pool query itself (both directions) so the matching module
   * needs no safety-module dependency.
   *
   * TODO(P3-08): exclude users the caller has already `pass`ed — the
   * interactions table does not exist yet, so no filter is applied.
   */
  async eligiblePool(forUserId: string, opts?: { limit?: number }): Promise<PoolCandidate[]> {
    const limit = Math.min(opts?.limit ?? this.config.MATCHING_POOL_LIMIT, this.config.MATCHING_POOL_LIMIT);
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

  /** Loads both sides of the pair in one 'matching' service-context transaction. */
  private async loadPair(aUserId: string, bUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'matching', true)`;
      const load = async (id: string): Promise<SideSnapshot> => {
        const user = await tx.user.findUnique({
          where: { id },
          select: { id: true, status: true, ageVerified: true, birthYear: true },
        });
        const profile = await tx.profile.findUnique({ where: { userId: id }, select: PROFILE_SELECT });
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
  private evaluatePair(a: SideSnapshot, b: SideSnapshot): HardFilterResult {
    const fails = new Set<string>();
    const notes = new Set<string>();
    this.checkDirection(a, b, fails, notes);
    this.checkDirection(b, a, fails, notes);
    logger.info(
      { a: a.user?.id, b: b.user?.id, compatible: fails.size === 0, codes: [...fails] },
      'hard filter check',
    );
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
