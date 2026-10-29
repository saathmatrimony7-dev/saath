/**
 * Billing surface (P4-06, DESIGN.md §11 + §13):
 *   GET  /v1/plans                      — active plans + intro packs
 *   POST /v1/subscriptions              — start a plan subscription
 *   POST /v1/subscriptions/:id/cancel   — self-serve, active to period end
 *   POST /v1/intro-packs/orders         — one-time intro pack order
 *   GET  /v1/invoices                   — owner invoice ledger
 * Authenticated (AuthGuard); mutating routes are CSRF-guarded. Entitlements
 * change ONLY via the verified webhook pipeline — these endpoints never
 * grant features directly (paywall integrity, exit criterion 2).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthGuard, CsrfGuard, CurrentUser } from '../identity/guards';
import { BillingService } from './billing.service';

const createSubscriptionSchema = z
  .object({
    planCode: z.string().min(1).max(64),
    clientRef: z.string().min(1).max(64).optional(),
  })
  .strict();

const createOrderSchema = z
  .object({
    planCode: z.string().min(1).max(64),
    clientRef: z.string().min(1).max(64).optional(),
  })
  .strict();

@Controller()
@UseGuards(AuthGuard)
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  @Get('plans')
  plans() {
    return this.billing.listPlans();
  }

  @Post('subscriptions')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  createSubscription(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(createSubscriptionSchema))
    body: z.infer<typeof createSubscriptionSchema>,
  ) {
    return this.billing.createSubscription(userId, body.planCode, body.clientRef);
  }

  @Post('subscriptions/:id/cancel')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  cancelSubscription(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) subscriptionId: string,
  ) {
    return this.billing.cancelSubscription(userId, subscriptionId);
  }

  @Post('intro-packs/orders')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  createIntroPackOrder(
    @CurrentUser() userId: string,
    @Body(new ZodValidationPipe(createOrderSchema)) body: z.infer<typeof createOrderSchema>,
  ) {
    return this.billing.createIntroPackOrder(userId, body.planCode, body.clientRef);
  }

  @Get('invoices')
  invoices(@CurrentUser() userId: string) {
    return this.billing.listInvoices(userId);
  }
}
