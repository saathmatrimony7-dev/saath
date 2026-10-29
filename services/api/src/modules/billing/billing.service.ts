/**
 * Billing (P4-06/07, DESIGN.md §13): plans, Razorpay subscriptions + intro
 * pack orders, GST-inclusive invoices with sequential per-year numbering,
 * and the verified-webhook pipeline that is the ONLY writer of
 * subscription/entitlement state. Webhook handling per §13: verify
 * signature → record event id (webhook_events, unique) → process in a
 * transaction → emit side effects. Retries/replays are safe: the event-id
 * insert dedupes, and every state transition is keyed on the provider's
 * idempotency surface (provider_sub_id / provider_payment_id / order id).
 *
 * All data access runs in the 'billing' service context (RLS).
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createLogger } from '@saath/logger';
import { PrismaService } from '../../prisma/prisma.service';
import type { RlsTransaction } from '../../prisma/rls-prisma.client';
import type { AppConfig } from '../../config';
import { APP_CONFIG } from '../identity/tokens';
import { NotificationsService } from '../notifications/notifications.service';
import { EntitlementsService } from './entitlements.service';
import type { RazorpayProvider } from './razorpay.provider';
import { RAZORPAY_PROVIDER } from './tokens';

const logger = createLogger('billing');

/** plan.interval → months to add for a period. */
const INTERVAL_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  '6m': 6,
};

function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // Clamp e.g. Jan 31 + 1 month → Feb 28/29 instead of Mar 3.
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}

/** GST portion of a tax-INCLUSIVE amount at rate bps (18% → 1800). */
function gstPortionInclusive(amountPaise: number, gstRateBps: number): number {
  return Math.floor((amountPaise * gstRateBps) / (10_000 + gstRateBps));
}

export interface RazorpayWebhookEvent {
  /** Deterministic dedupe id: `${event}:${entityId}`. */
  eventId: string;
  event: string;
  subscriptionId?: string;
  paymentId?: string;
  orderId?: string;
  amountPaise?: number;
}

@Injectable()
export class BillingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RAZORPAY_PROVIDER) private readonly razorpay: RazorpayProvider,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  // ---- User-facing surface -------------------------------------------------

  async listPlans() {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'billing', true)`;
      const rows = await tx.plan.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
      return rows.map((p) => ({
        code: p.id,
        kind: p.kind,
        pricePaise: p.pricePaise,
        interval: p.interval,
        features: p.features,
      }));
    });
  }

  /**
   * Starts a subscription for a plan (recurring). Idempotent per
   * (user, clientRef): a repeat POST with the same key returns the
   * original subscription (§11 idempotency keys).
   */
  async createSubscription(userId: string, planCode: string, clientRef?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'billing', true)`;
      if (clientRef) {
        const existing = await tx.subscription.findFirst({
          where: { userId, clientRef },
        });
        if (existing) return this.subscriptionView(existing);
      }
      const plan = await tx.plan.findFirst({
        where: { id: planCode, kind: 'plan', active: true },
      });
      if (!plan) throw new NotFoundException('plan not found');
      const { providerSubId } = await this.razorpay.createSubscription(planCode);
      const created = await tx.subscription.create({
        data: { userId, planId: plan.id, providerSubId, clientRef: clientRef ?? null },
      });
      return this.subscriptionView(created);
    });
  }

  /**
   * Self-serve cancellation (§13: ≤ 2 clicks, no dark patterns): the plan
   * stays active to period end. Idempotent — repeating it is a no-op.
   */
  async cancelSubscription(userId: string, subscriptionId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'billing', true)`;
      const sub = await tx.subscription.findUnique({ where: { id: subscriptionId } });
      if (!sub || sub.userId !== userId) throw new NotFoundException('subscription not found');
      if (sub.status === 'active') {
        await this.razorpay.cancelSubscription(sub.providerSubId);
        await tx.subscription.update({
          where: { id: sub.id },
          data: { cancelAtPeriodEnd: true },
        });
      }
    });
    return { cancelled: true };
  }

  /**
   * Creates a one-time order for an intro pack. Idempotent per (user,
   * clientRef). Credits land only when the payment.captured webhook
   * arrives (verified pipeline — never from this response).
   */
  async createIntroPackOrder(userId: string, planCode: string, clientRef?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'billing', true)`;
      if (clientRef) {
        const existing = await tx.order.findFirst({ where: { userId, clientRef } });
        if (existing) return this.orderView(existing);
      }
      const plan = await tx.plan.findFirst({
        where: { id: planCode, kind: 'intro_pack', active: true },
      });
      if (!plan) throw new NotFoundException('intro pack not found');
      const { providerOrderId } = await this.razorpay.createOrder(planCode, plan.pricePaise);
      const created = await tx.order.create({
        data: {
          userId,
          planId: plan.id,
          providerOrderId,
          amountPaise: plan.pricePaise,
          clientRef: clientRef ?? null,
        },
      });
      return this.orderView(created);
    });
  }

  async listInvoices(userId: string) {
    return this.prisma.withUser(userId, async (tx) => {
      const rows = await tx.invoice.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return rows.map((i) => ({
        id: i.id,
        invoiceNo: i.invoiceNo,
        lineItem: i.lineItem,
        amountPaise: i.amountPaise,
        gstPaise: i.gstPaise,
        currency: i.currency,
        createdAt: i.createdAt,
      }));
    });
  }

  // ---- Verified webhook pipeline (P4-07) -----------------------------------

  /**
   * Processes one verified Razorpay event inside a single transaction.
   * Called ONLY after the event id has been recorded in webhook_events
   * (idempotency), so replays never reach this code. Unknown/disowned
   * entities are logged and skipped — a provider event for something we
   * did not create must not fail the batch (and retries stay no-ops).
   */
  async processWebhook(evt: RazorpayWebhookEvent): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'billing', true)`;
      switch (evt.event) {
        case 'subscription.activated':
          await this.handleSubscriptionActivated(tx as RlsTransaction, evt);
          break;
        case 'subscription.charged':
          await this.handleSubscriptionCharged(tx as RlsTransaction, evt);
          break;
        case 'subscription.cancelled':
          await this.handleSubscriptionCancelled(tx as RlsTransaction, evt);
          break;
        case 'payment.captured':
          await this.handlePaymentCaptured(tx as RlsTransaction, evt);
          break;
        case 'payment.failed':
          await this.handlePaymentFailed(tx as RlsTransaction, evt);
          break;
        default:
          logger.warn({ event: evt.event }, 'unhandled razorpay event skipped');
      }
    });
  }

  private async handleSubscriptionActivated(tx: RlsTransaction, evt: RazorpayWebhookEvent) {
    const sub = await this.findOwnedSubscription(tx, evt.subscriptionId);
    if (!sub) return;
    const months = INTERVAL_MONTHS[sub.plan.interval ?? ''] ?? 1;
    const base =
      sub.currentPeriodEnd && sub.currentPeriodEnd > new Date() ? sub.currentPeriodEnd : new Date();
    const periodEnd = addMonths(base, months);
    await tx.subscription.update({
      where: { id: sub.id },
      data: { status: 'active', currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false },
    });
    await this.setValidUntil(tx, sub.userId, periodEnd);
    await this.notifications.notifyInTx(tx, sub.userId, 'subscription.activated', {
      planId: sub.planId,
      subscriptionId: sub.id,
    });
  }

  private async handleSubscriptionCharged(tx: RlsTransaction, evt: RazorpayWebhookEvent) {
    const sub = await this.findOwnedSubscription(tx, evt.subscriptionId);
    if (!sub) return;
    // Renewal: extend the period from the current end (or now when lapsed).
    const months = INTERVAL_MONTHS[sub.plan.interval ?? ''] ?? 1;
    const base =
      sub.currentPeriodEnd && sub.currentPeriodEnd > new Date() ? sub.currentPeriodEnd : new Date();
    const periodEnd = addMonths(base, months);
    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        status: 'active',
        currentPeriodEnd: periodEnd,
        ...(sub.cancelAtPeriodEnd ? {} : { cancelAtPeriodEnd: false }),
      },
    });
    await this.setValidUntil(tx, sub.userId, periodEnd);
    if (evt.paymentId && evt.amountPaise) {
      await this.recordCapturedPayment(tx, {
        userId: sub.userId,
        providerPaymentId: evt.paymentId,
        providerSubId: sub.providerSubId,
        amountPaise: evt.amountPaise,
        lineItem: sub.planId,
        gstRateBps: sub.plan.gstRateBps,
      });
    }
  }

  private async handleSubscriptionCancelled(tx: RlsTransaction, evt: RazorpayWebhookEvent) {
    const sub = await this.findOwnedSubscription(tx, evt.subscriptionId);
    if (!sub) return;
    // §13: cancellation keeps the plan active to period end.
    await tx.subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true, status: 'active' },
    });
    if (sub.currentPeriodEnd) await this.setValidUntil(tx, sub.userId, sub.currentPeriodEnd);
  }

  private async handlePaymentCaptured(tx: RlsTransaction, evt: RazorpayWebhookEvent) {
    if (!evt.paymentId) return;
    // Subscription-renewal payments carry providerSubId and are handled by
    // subscription.charged; here we handle one-time intro-pack orders.
    if (evt.orderId) {
      const order = await tx.order.findUnique({ where: { providerOrderId: evt.orderId } });
      if (!order) {
        logger.warn({ orderId: evt.orderId }, 'payment.captured for unknown order; skipped');
        return;
      }
      if (order.status === 'captured') return; // replay inside the same event stream
      const plan = await tx.plan.findUniqueOrThrow({ where: { id: order.planId } });
      const features = (plan.features ?? {}) as Record<string, unknown>;
      const credits = typeof features.introCredits === 'number' ? features.introCredits : 0;
      await tx.order.update({ where: { id: order.id }, data: { status: 'captured' } });
      if (credits > 0) await this.entitlements.addIntroCreditsInTx(tx, order.userId, credits);
      await this.recordCapturedPayment(tx, {
        userId: order.userId,
        providerPaymentId: evt.paymentId,
        providerOrderId: order.providerOrderId,
        amountPaise: evt.amountPaise ?? order.amountPaise,
        lineItem: plan.id,
        gstRateBps: plan.gstRateBps,
      });
      await this.notifications.notifyInTx(tx, order.userId, 'intro_pack.credited', {
        planId: plan.id,
        credits,
      });
    }
  }

  private async handlePaymentFailed(tx: RlsTransaction, evt: RazorpayWebhookEvent) {
    if (!evt.paymentId) return;
    const byPayment = await tx.payment.findUnique({
      where: { providerPaymentId: evt.paymentId },
    });
    if (byPayment) {
      await tx.payment.update({
        where: { id: byPayment.id },
        data: { status: 'failed' },
      });
      return;
    }
    if (evt.orderId) {
      await tx.order.updateMany({
        where: { providerOrderId: evt.orderId, status: 'pending' },
        data: { status: 'failed' },
      });
    }
  }

  // ---- Internals -----------------------------------------------------------

  private async findOwnedSubscription(tx: RlsTransaction, providerSubId?: string) {
    if (!providerSubId) return null;
    return tx.subscription.findUnique({
      where: { providerSubId },
      include: { plan: true },
    });
  }

  private async setValidUntil(tx: RlsTransaction, userId: string, validUntil: Date) {
    await tx.entitlement.upsert({
      where: { userId },
      create: { userId, validUntil },
      update: { validUntil, version: { increment: 1 } },
    });
  }

  /**
   * Payment + sequential GST invoice, idempotent per provider payment id
   * (unique constraint — a retried webhook for the same payment is a no-op).
   */
  private async recordCapturedPayment(
    tx: RlsTransaction,
    input: {
      userId: string;
      providerPaymentId: string;
      providerOrderId?: string;
      providerSubId?: string;
      amountPaise: number;
      lineItem: string;
      gstRateBps: number;
    },
  ): Promise<void> {
    const existing = await tx.payment.findUnique({
      where: { providerPaymentId: input.providerPaymentId },
    });
    if (existing) return;
    const invoice = await this.createInvoice(tx, {
      userId: input.userId,
      lineItem: input.lineItem,
      amountPaise: input.amountPaise,
      gstRateBps: input.gstRateBps,
      providerPaymentId: input.providerPaymentId,
    });
    await tx.payment.create({
      data: {
        userId: input.userId,
        providerPaymentId: input.providerPaymentId,
        providerOrderId: input.providerOrderId ?? null,
        providerSubId: input.providerSubId ?? null,
        amountPaise: input.amountPaise,
        status: 'captured',
        invoiceId: invoice.id,
      },
    });
  }

  private async createInvoice(
    tx: RlsTransaction,
    input: {
      userId: string;
      lineItem: string;
      amountPaise: number;
      gstRateBps: number;
      providerPaymentId: string;
    },
  ) {
    const year = new Date().getUTCFullYear();
    const counters = await tx.$queryRaw<[{ seq: number }]>`
      INSERT INTO "invoice_counters" ("year", "seq") VALUES (${year}, 1)
      ON CONFLICT ("year") DO UPDATE SET "seq" = "invoice_counters"."seq" + 1
      RETURNING "seq"`;
    const seq = counters[0]?.seq ?? 1;
    const invoiceNo = `INV-${year}-${String(seq).padStart(6, '0')}`;
    return tx.invoice.create({
      data: {
        userId: input.userId,
        invoiceNo,
        lineItem: input.lineItem,
        amountPaise: input.amountPaise,
        gstPaise: gstPortionInclusive(input.amountPaise, input.gstRateBps),
        providerPaymentId: input.providerPaymentId,
      },
    });
  }

  private subscriptionView(s: {
    id: string;
    planId: string;
    status: string;
    providerSubId: string;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  }) {
    return {
      id: s.id,
      planId: s.planId,
      status: s.status,
      providerSubId: s.providerSubId,
      currentPeriodEnd: s.currentPeriodEnd,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    };
  }

  private orderView(o: {
    id: string;
    planId: string;
    providerOrderId: string;
    amountPaise: number;
    status: string;
  }) {
    return {
      id: o.id,
      planId: o.planId,
      providerOrderId: o.providerOrderId,
      amountPaise: o.amountPaise,
      status: o.status,
    };
  }
}
