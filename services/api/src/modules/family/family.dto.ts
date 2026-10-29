/**
 * Family Mode DTOs (P3-10). All strict; unknown fields rejected (rule 3).
 * D7: permissions are view/comment ONLY — any other key is a 400, so no
 * family member can ever be granted (or grant themselves) more than the
 * owner explicitly approves at the endpoint layer.
 */
import { z } from 'zod';

export const FAMILY_RELATIONS = ['parent', 'sibling', 'child', 'guardian', 'other'] as const;
export const FAMILY_SIGNALS = ['approve', 'reject', 'interested', 'concern'] as const;

export const createInviteSchema = z
  .object({
    relation: z.enum(FAMILY_RELATIONS),
    permissions: z
      .object({ view: z.boolean(), comment: z.boolean() })
      .strict()
      .default({ view: true, comment: true }),
    ttlDays: z.coerce.number().int().min(1).max(30).optional(),
  })
  .strict();

export const acceptInviteSchema = z
  .object({
    token: z.string().min(20).max(128),
  })
  .strict();

export const familyFeedbackSchema = z
  .object({
    ownerId: z.string().uuid().optional(),
    candidateId: z.string().uuid(),
    signal: z.enum(FAMILY_SIGNALS),
    comment: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const ownerIdQuerySchema = z
  .object({
    ownerId: z.string().uuid().optional(),
  })
  .strict();

export type CreateInviteDto = z.infer<typeof createInviteSchema>;
export type AcceptInviteDto = z.infer<typeof acceptInviteSchema>;
export type FamilyFeedbackDto = z.infer<typeof familyFeedbackSchema>;
