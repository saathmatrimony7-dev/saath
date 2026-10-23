/**
 * Applies the curated taxonomy seed (idempotent upserts).
 * Reference data — written under the service context (RLS: writes are
 * service-only; the app role can only SELECT).
 */
import type { RlsPrismaClient } from '../src/prisma/rls-prisma.client';
import {
  RELIGIONS,
  COMMUNITIES,
  SUB_COMMUNITIES,
  CITIES,
  ATTRIBUTE_DEFINITIONS,
} from './seed-taxonomy';

export async function seedTaxonomy(prisma: RlsPrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const r of RELIGIONS) {
      await tx.taxonomyReligion.upsert({
        where: { id: r.id },
        create: { id: r.id, labelI18n: r.label, sortOrder: r.sort },
        update: { labelI18n: r.label, sortOrder: r.sort },
      });
    }
    for (const c of COMMUNITIES) {
      await tx.taxonomyCommunity.upsert({
        where: { id: c.id },
        create: { id: c.id, religionId: c.religion, labelI18n: c.label, sortOrder: c.sort },
        update: { religionId: c.religion, labelI18n: c.label, sortOrder: c.sort },
      });
    }
    for (const s of SUB_COMMUNITIES) {
      await tx.taxonomySubCommunity.upsert({
        where: { id: s.id },
        create: { id: s.id, communityId: s.community, labelI18n: s.label, sortOrder: s.sort },
        update: { communityId: s.community, labelI18n: s.label, sortOrder: s.sort },
      });
    }
    for (const c of CITIES) {
      await tx.taxonomyCity.upsert({
        where: { id: c.id },
        create: { id: c.id, labelI18n: c.label, state: c.state },
        update: { labelI18n: c.label, state: c.state },
      });
    }
    for (const a of ATTRIBUTE_DEFINITIONS) {
      await tx.attributeDefinition.upsert({
        where: { key: a.key },
        create: {
          key: a.key,
          communityScope: a.communityScope,
          type: a.type,
          options: a.options?.map((o) => ({ value: o.value, label_i18n: o.label })) ?? undefined,
          sensitivity: a.sensitivity,
          labelI18n: a.label,
        },
        update: {
          communityScope: a.communityScope,
          type: a.type,
          options: a.options?.map((o) => ({ value: o.value, label_i18n: o.label })) ?? undefined,
          sensitivity: a.sensitivity,
          labelI18n: a.label,
        },
      });
    }
  });

  console.log(
    `taxonomy seeded: ${RELIGIONS.length} religions, ${COMMUNITIES.length} communities, ` +
      `${SUB_COMMUNITIES.length} sub-communities, ${CITIES.length} cities, ` +
      `${ATTRIBUTE_DEFINITIONS.length} attribute definitions`,
  );
}
