/**
 * Razorpay webhook (P4-07, DESIGN.md §11 + §13):
 *   POST /v1/hooks/razorpay
 * Signature-verified (HMAC-SHA256 of the raw body with the webhook secret,
 * constant-time), idempotent by deterministic event id
 * (`${event}:${entityId}` recorded in webhook_events), processed in a single
 * transaction by BillingService. Replays return 200 without reprocessing —
 * the webhook replay test (P4 exit criterion 1) exercises exactly this.
 * Unauthenticated by nature; the signature IS the authentication.
 */
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../../config';
import { APP_CONFIG } from '../identity/tokens';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService, type RazorpayWebhookEvent } from './billing.service';

function signRazorpayBody(secret: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function verifyRazorpaySignature(secret: string, rawBody: Buffer, header: string): boolean {
  const expected = Buffer.from(signRazorpayBody(secret, rawBody));
  const presented = Buffer.from(header.trim());
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

const webhookSchema = z
  .object({
    event: z.enum([
      'subscription.activated',
      'subscription.charged',
      'subscription.cancelled',
      'payment.captured',
      'payment.failed',
    ]),
    payload: z
      .object({
        subscription: z
          .object({ entity: z.object({ id: z.string().min(1) }) })
          .strict()
          .optional(),
        payment: z
          .object({
            entity: z.object({
              id: z.string().min(1),
              order_id: z.string().min(1).nullable().optional(),
              amount: z.number().int().positive().optional(),
            }),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('hooks')
export class RazorpayWebhookController {
  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('razorpay')
  @HttpCode(200)
  async inbound(
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Req() req: RawBodyRequest,
    @Body(new ZodValidationPipe(webhookSchema)) dto: z.infer<typeof webhookSchema>,
  ): Promise<{ received: true; duplicate?: true }> {
    const rawBody = req.rawBody;
    if (
      !rawBody ||
      !signature ||
      !verifyRazorpaySignature(this.config.RAZORPAY_WEBHOOK_SECRET, rawBody, signature)
    ) {
      throw new UnauthorizedException('invalid webhook signature');
    }

    const subscriptionId = dto.payload.subscription?.entity.id;
    const paymentEntity = dto.payload.payment?.entity;
    // Deterministic dedupe id: replays of the SAME delivery share it, while
    // distinct deliveries about the same entity (e.g. monthly
    // subscription.charged events, each with its own payment) stay unique.
    const eventId = `${dto.event}:${paymentEntity?.id ?? subscriptionId ?? 'unknown'}`;
    const evt: RazorpayWebhookEvent = {
      eventId,
      event: dto.event,
      subscriptionId,
      paymentId: paymentEntity?.id,
      orderId: paymentEntity?.order_id ?? undefined,
      amountPaise: paymentEntity?.amount,
    };

    // Idempotency: record the event id FIRST (§13); a replayed delivery is
    // acknowledged without reprocessing. The lookup keeps expected replays
    // off the error path; the unique constraint remains the concurrency
    // backstop (two simultaneous first deliveries — one wins).
    const seen = await this.prisma.webhookEvent.findUnique({ where: { id: eventId } });
    if (seen) return { received: true, duplicate: true };
    try {
      await this.prisma.webhookEvent.create({
        data: { id: eventId, source: 'razorpay' },
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        return { received: true, duplicate: true };
      }
      throw err;
    }

    await this.billing.processWebhook(evt);
    return { received: true };
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    );
  }
}

/** Test helper: signs a webhook body the way Razorpay does. */
export function signRazorpayWebhookForTests(secret: string, body: string): string {
  return signRazorpayBody(secret, Buffer.from(body));
}
