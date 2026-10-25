/**
 * Safety DTOs (P2-03). Reasons are a closed vocabulary so the ledger stays
 * analysable; details are optional and length-capped (C2 user text).
 */
import { z } from 'zod';

export const REPORT_REASONS = [
  'harassment',
  'scam',
  'fake_profile',
  'inappropriate_content',
  'underage',
  'other',
] as const;

export const reportUserSchema = z
  .object({
    reason: z.enum(REPORT_REASONS),
    details: z.string().max(1000).optional(),
  })
  .strict();
export type ReportUserDto = z.infer<typeof reportUserSchema>;
