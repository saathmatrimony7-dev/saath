import { z } from 'zod';

export const otpRequestSchema = z
  .object({
    phone: z.string().min(10).max(16),
  })
  .strict();

export const otpVerifySchema = z
  .object({
    phone: z.string().min(10).max(16),
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();

export type OtpRequestDto = z.infer<typeof otpRequestSchema>;
export type OtpVerifyDto = z.infer<typeof otpVerifySchema>;
