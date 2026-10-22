-- P0-08: OTP state table + refresh-token rotation support.

-- AlterTable: refresh rotation (reuse detection) + unique lookup by token hash
ALTER TABLE "sessions" ADD COLUMN "previous_refresh_token_hash" TEXT;
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateTable: pre-auth OTP state (identity infrastructure, not user data)
CREATE TABLE "otp_codes" (
    "phone_e164_hash" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("phone_e164_hash")
);

-- ---------------------------------------------------------------------------
-- RLS: otp_codes is reachable only in the identity-service context
-- (app.service = 'identity'); there is no user context before login.
-- ---------------------------------------------------------------------------
ALTER TABLE "otp_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "otp_codes" FORCE ROW LEVEL SECURITY;

CREATE POLICY otp_identity_service_only ON "otp_codes"
  USING (current_setting('app.service', true) = 'identity')
  WITH CHECK (current_setting('app.service', true) = 'identity');

GRANT SELECT, INSERT, UPDATE, DELETE ON "otp_codes" TO app_user;

-- ---------------------------------------------------------------------------
-- Pre-auth lookups: the identity service must find a user by phone hash and a
-- session by refresh-token hash BEFORE a user context exists. These policies
-- allow that path; service-layer code only ever queries by unique hash.
-- ---------------------------------------------------------------------------
CREATE POLICY users_identity_lookup ON "users"
  USING (current_setting('app.service', true) = 'identity')
  WITH CHECK (current_setting('app.service', true) = 'identity');

CREATE POLICY sessions_identity_lookup ON "sessions"
  USING (current_setting('app.service', true) = 'identity')
  WITH CHECK (current_setting('app.service', true) = 'identity');
