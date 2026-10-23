/**
 * Profiles / preferences DTOs (P1-03). All strict (rule 3): unknown fields 400.
 * Free-text fields are length-bounded; reference-data fields are taxonomy slugs
 * (FK-checked in the DB). Community attribute values are validated against
 * attribute_definitions in the service layer.
 */
import { z } from 'zod';

export const PROFILE_VISIBILITIES = ['public', 'members', 'matches_only', 'hidden'] as const;
export const DIET_VALUES = ['veg', 'eggetarian', 'non_veg', 'jain_veg', 'vegan'] as const;
export const MARITAL_STATUSES = [
  'never_married',
  'divorced',
  'widowed',
  'separated',
] as const;

const attributeValue = z.union([
  z.string().max(500),
  z.number(),
  z.boolean(),
  z.array(z.string().max(100)).max(50),
]);

export const patchProfileSchema = z
  .object({
    displayName: z.string().min(1).max(100).optional(),
    aboutNormalised: z.string().max(2000).optional(),
    heightCm: z.number().int().min(100).max(250).optional(),
    maritalStatus: z.enum(MARITAL_STATUSES).optional(),
    hasChildren: z.boolean().optional(),
    diet: z.enum(DIET_VALUES).optional(),
    educationLevel: z.string().max(64).optional(),
    profession: z.string().max(100).optional(),
    incomeBand: z.string().max(32).optional(),
    cityId: z.string().max(64).nullable().optional(),
    willingToRelocate: z.boolean().optional(),
    religionId: z.string().max(64).nullable().optional(),
    communityId: z.string().max(64).nullable().optional(),
    subCommunityId: z.string().max(64).nullable().optional(),
    motherTongue: z.string().regex(/^[a-z]{2,3}$/).optional(),
    visibility: z.enum(PROFILE_VISIBILITIES).optional(),
    attributes: z
      .array(
        z
          .object({
            key: z.string().min(1).max(64),
            value: attributeValue,
            visibility: z.enum(PROFILE_VISIBILITIES).default('matches_only'),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict();

export type PatchProfileDto = z.infer<typeof patchProfileSchema>;

export const putPreferencesSchema = z
  .object({
    ageMin: z.number().int().min(18).max(120).nullable().optional(),
    ageMax: z.number().int().min(18).max(120).nullable().optional(),
    heightMin: z.number().int().min(100).max(250).nullable().optional(),
    cities: z.array(z.string().max(64)).max(50).optional(),
    relocateOk: z.boolean().optional(),
    communityFilter: z
      .object({
        religions: z.array(z.string().max(64)).max(20).optional(),
        communities: z.array(z.string().max(64)).max(50).optional(),
      })
      .strict()
      .nullable()
      .optional(),
    openToAllCommunities: z.boolean().optional(),
    dietOk: z.array(z.enum(DIET_VALUES)).max(10).optional(),
    maritalOk: z.array(z.enum(MARITAL_STATUSES)).max(10).optional(),
  })
  .strict();

export type PutPreferencesDto = z.infer<typeof putPreferencesSchema>;

const ruleValue = z.union([z.string().max(200), z.number(), z.boolean()]);
const ruleSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('eq'), value: ruleValue }).strict(),
  z.object({ op: z.literal('neq'), value: ruleValue }).strict(),
  z
    .object({ op: z.literal('in'), value: z.array(z.string().max(200)).min(1).max(50) })
    .strict(),
  z
    .object({ op: z.literal('not_in'), value: z.array(z.string().max(200)).min(1).max(50) })
    .strict(),
  z.object({ op: z.literal('lt'), value: z.number() }).strict(),
  z.object({ op: z.literal('gt'), value: z.number() }).strict(),
]);

export const putDealbreakersSchema = z
  .object({
    dealbreakers: z
      .array(
        z
          .object({
            field: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
            rule: ruleSchema,
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export type PutDealbreakersDto = z.infer<typeof putDealbreakersSchema>;

export const SHARE_LEVELS = ['minimal', 'standard', 'detailed'] as const;

export const putDisclosureSchema = z
  .object({
    shareLevel: z.enum(SHARE_LEVELS),
  })
  .strict();

export type PutDisclosureDto = z.infer<typeof putDisclosureSchema>;
