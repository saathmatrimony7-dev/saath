-- P4-06: billing (DESIGN.md §13) — plans + consumable intro packs,
-- Razorpay subscription lifecycle mirror, entitlements (the single source of
-- truth for feature gating), payment ledger, sequential GST-inclusive
-- invoices. Owner-read for user tables; ALL writes are service-context only
-- (webhook processing runs in the 'billing' service context, P4-07).

CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'plan', -- plan | intro_pack
    "price_paise" INTEGER NOT NULL,
    "interval" TEXT, -- monthly | quarterly | 6m (NULL for intro packs)
    "gst_rate_bps" INTEGER NOT NULL DEFAULT 1800, -- 18% GST, price is INCLUSIVE
    "features" JSONB NOT NULL, -- {"chat":..,"calls":..,"dailyMessageLimit":..,"introCredits":..}
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "plans_kind_ck" CHECK ("kind" IN ('plan', 'intro_pack')),
    CONSTRAINT "plans_interval_ck" CHECK ("interval" IS NULL OR "interval" IN ('monthly', 'quarterly', '6m')),
    CONSTRAINT "plans_price_ck" CHECK ("price_paise" >= 0), -- 0 = the free plan
    CONSTRAINT "plans_gst_ck" CHECK ("gst_rate_bps" >= 0 AND "gst_rate_bps" <= 10000)
);

-- Reference data (prices are GST-inclusive placeholder list prices, §13 D6):
-- free is the effective plan when no subscription is active; intro packs are
-- consumable message-anyone credits (P4-06).
INSERT INTO "plans" ("id", "kind", "price_paise", "interval", "features", "active", "sort_order")
VALUES
  ('free',           'plan',       0,      NULL,
   '{"chat":true,"calls":false,"dailyMessageLimit":20,"introCredits":0}', true, 0),
  ('plus_monthly',   'plan',       59000,  'monthly',
   '{"chat":true,"calls":true,"dailyMessageLimit":-1,"introCredits":0}',  true, 1),
  ('plus_quarterly', 'plan',       149000, 'quarterly',
   '{"chat":true,"calls":true,"dailyMessageLimit":-1,"introCredits":0}',  true, 2),
  ('plus_6m',        'plan',       249000, '6m',
   '{"chat":true,"calls":true,"dailyMessageLimit":-1,"introCredits":0}',  true, 3),
  ('intro_5',        'intro_pack', 49000,  NULL,
   '{"introCredits":5}', true, 10);

CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "plan_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "provider_sub_id" TEXT NOT NULL,
    "client_ref" TEXT, -- client idempotency key (unique per user)
    "status" TEXT NOT NULL DEFAULT 'pending', -- pending | active | cancelled | expired
    "current_period_end" TIMESTAMPTZ,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscriptions_user_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "subscriptions_plan_fkey"
      FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON UPDATE CASCADE,
    CONSTRAINT "subscriptions_provider_sub_key" UNIQUE ("provider_sub_id"),
    CONSTRAINT "subscriptions_status_ck"
      CHECK ("status" IN ('pending', 'active', 'cancelled', 'expired'))
);

CREATE TABLE "entitlements" (
    "user_id" UUID NOT NULL,
    "features" JSONB NOT NULL DEFAULT '{}', -- overlays the plan row
    "intro_credits" INTEGER NOT NULL DEFAULT 0,
    "valid_until" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "entitlements_user_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "entitlements_credits_ck" CHECK ("intro_credits" >= 0)
);

CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "provider_payment_id" TEXT NOT NULL,
    "provider_order_id" TEXT,
    "provider_sub_id" TEXT,
    "amount_paise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending', -- pending | captured | failed | refunded
    "invoice_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payments_user_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "payments_payment_key" UNIQUE ("provider_payment_id"),
    CONSTRAINT "payments_status_ck"
      CHECK ("status" IN ('pending', 'captured', 'failed', 'refunded'))
);

CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "invoice_no" TEXT NOT NULL,
    "line_item" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL, -- GST-inclusive
    "gst_paise" INTEGER NOT NULL,    -- GST portion of the amount
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "provider_payment_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoices_no_key" UNIQUE ("invoice_no"),
    CONSTRAINT "invoices_user_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- One-time orders (intro packs). The captured payment arrives by webhook
-- (payment.captured with the provider order id) and credits the pack.
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "plan_id" TEXT NOT NULL,
    "provider_order_id" TEXT NOT NULL,
    "client_ref" TEXT, -- client idempotency key (unique per user)
    "amount_paise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending', -- pending | captured | failed
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "orders_user_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "orders_plan_fkey"
      FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON UPDATE CASCADE,
    CONSTRAINT "orders_order_key" UNIQUE ("provider_order_id"),
    CONSTRAINT "orders_status_ck" CHECK ("status" IN ('pending', 'captured', 'failed'))
);

-- Sequential invoice numbering (INV-<calendar-year>-<seq>), incremented in
-- the same tx that creates the invoice (P4-06). Raw-SQL only table.
CREATE TABLE "invoice_counters" (
    "year" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("year")
);

CREATE INDEX "subscriptions_user_idx" ON "subscriptions"("user_id", "status");
CREATE INDEX "orders_user_idx" ON "orders"("user_id", "created_at" DESC);
CREATE INDEX "payments_user_idx" ON "payments"("user_id", "created_at" DESC);
CREATE INDEX "invoices_user_idx" ON "invoices"("user_id", "created_at" DESC);

-- plans is reference data: world-readable, service-only writes.
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plans" FORCE ROW LEVEL SECURITY;
CREATE POLICY plans_select_all ON "plans" FOR SELECT USING (true);
CREATE POLICY plans_service_all ON "plans" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_select_own ON "subscriptions" FOR SELECT
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY subscriptions_service_all ON "subscriptions" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

ALTER TABLE "entitlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "entitlements" FORCE ROW LEVEL SECURITY;
CREATE POLICY entitlements_select_own ON "entitlements" FOR SELECT
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY entitlements_service_all ON "entitlements" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY payments_select_own ON "payments" FOR SELECT
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY payments_service_all ON "payments" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY invoices_select_own ON "invoices" FOR SELECT
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY invoices_service_all ON "invoices" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY orders_select_own ON "orders" FOR SELECT
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY orders_service_all ON "orders" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

GRANT SELECT, INSERT, UPDATE, DELETE ON "plans" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "orders" TO app_user;

-- Client idempotency keys (§11): at most one create per (user, clientRef).
CREATE UNIQUE INDEX "subscriptions_user_client_ref_key" ON "subscriptions"("user_id", "client_ref")
  WHERE "client_ref" IS NOT NULL;
CREATE UNIQUE INDEX "orders_user_client_ref_key" ON "orders"("user_id", "client_ref")
  WHERE "client_ref" IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON "subscriptions" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "entitlements" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "payments" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "invoices" TO app_user;
GRANT SELECT, INSERT, UPDATE ON "invoice_counters" TO app_user;
