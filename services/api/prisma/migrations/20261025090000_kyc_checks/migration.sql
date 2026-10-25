-- P2-01: KYC orchestration (DESIGN.md §10.4). Raw documents are NEVER stored:
-- only the result, provider reference, score, provider age and a masked ID.
-- RLS: owner SELECT; the webhook (service context) writes results.

CREATE TABLE "kyc_checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "score" DOUBLE PRECISION,
    "age" SMALLINT,
    "name_match" BOOLEAN,
    "masked_id" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "kyc_checks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kyc_checks_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "kyc_checks_type_ck" CHECK ("type" IN ('id', 'id_liveness', 'employment')),
    CONSTRAINT "kyc_checks_status_ck"
      CHECK ("status" IN ('pending', 'pass', 'fail', 'error'))
);
CREATE INDEX "kyc_checks_user_idx" ON "kyc_checks"("user_id", "created_at" DESC);
CREATE INDEX "kyc_checks_provider_ref_idx" ON "kyc_checks"("provider_ref");

ALTER TABLE "kyc_checks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kyc_checks" FORCE ROW LEVEL SECURITY;
CREATE POLICY kyc_checks_select_own ON "kyc_checks" FOR SELECT
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY kyc_checks_insert_own ON "kyc_checks" FOR INSERT
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
-- Webhook result delivery runs in the 'verification' service context.
CREATE POLICY kyc_checks_service_all ON "kyc_checks" FOR ALL
  USING (current_setting('app.service', true) = 'verification')
  WITH CHECK (current_setting('app.service', true) = 'verification');

GRANT SELECT, INSERT, UPDATE ON "kyc_checks" TO app_user;
