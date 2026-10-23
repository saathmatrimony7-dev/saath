import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Resolve a label_i18n jsonb to a single locale string with en fallback. */
export function resolveLabel(labelI18n: unknown, locale: string): string {
  if (labelI18n && typeof labelI18n === 'object') {
    const map = labelI18n as Record<string, string>;
    return map[locale] ?? map['en'] ?? '';
  }
  return '';
}

/**
 * Taxonomy is reference data: readable by any authenticated caller
 * (RLS policy USING true), writable only via migrations/admin tooling.
 * Community/caste data is user-declared filter material ONLY — nothing here
 * infers or assigns it (rule 10; a test in test/taxonomy enforces this).
 */
@Injectable()
export class TaxonomyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async religions(locale: string) {
    const rows = await this.prisma.taxonomyReligion.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, label: resolveLabel(r.labelI18n, locale) }));
  }

  async communities(religionId: string, locale: string) {
    const rows = await this.prisma.taxonomyCommunity.findMany({
      where: { religionId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((c) => ({ id: c.id, label: resolveLabel(c.labelI18n, locale) }));
  }

  async subCommunities(communityId: string, locale: string) {
    const rows = await this.prisma.taxonomySubCommunity.findMany({
      where: { communityId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((s) => ({ id: s.id, label: resolveLabel(s.labelI18n, locale) }));
  }

  async cities(q: string | undefined, locale: string) {
    const rows = await this.prisma.taxonomyCity.findMany({
      where: q
        ? { labelI18n: { path: ['en'], string_contains: q, mode: 'insensitive' } }
        : undefined,
      take: 50,
    });
    return rows.map((c) => ({
      id: c.id,
      label: resolveLabel(c.labelI18n, locale),
      state: c.state,
      country: c.country,
    }));
  }

  /** Attribute definitions applicable to a community (global + community-scoped). */
  async attributeDefinitions(communityId: string | undefined, locale: string) {
    const rows = await this.prisma.attributeDefinition.findMany({
      where: communityId
        ? { OR: [{ communityScope: null }, { communityScope: communityId }] }
        : { communityScope: null },
    });
    return rows.map((a) => ({
      key: a.key,
      type: a.type,
      sensitivity: a.sensitivity,
      communityScope: a.communityScope,
      label: resolveLabel(a.labelI18n, locale),
      options: Array.isArray(a.options)
        ? (a.options as { value: string; label_i18n: unknown }[]).map((o) => ({
            value: o.value,
            label: resolveLabel(o.label_i18n, locale),
          }))
        : [],
    }));
  }
}
