-- P3-10: Family Mode v1 (DESIGN.md §9 accounts_family / family_feedback,
-- §10.2(c) family_mode consent, D7 default permissions view+comment).
--
-- accounts_family extends DESIGN's sketch with member_user_id NULL while the
-- invite is pending (the sketch's NOT NULL cannot represent a pending invite
-- before the member has an account — members sign up via the normal phone-OTP
-- flow and bind themselves at accept time).

CREATE TABLE "accounts_family" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profile_user_id" UUID NOT NULL,   -- the owner whose shortlist is shared
    "member_user_id" UUID,             -- NULL = invite pending acceptance
    "relation" TEXT NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '{"view": true, "comment": true}'::jsonb,
    "invited_by" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|expired|revoked
    "invite_token_hash" TEXT,
    "accepted_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "accounts_family_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "accounts_family_owner_fkey"
      FOREIGN KEY ("profile_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "accounts_family_member_fkey"
      FOREIGN KEY ("member_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "accounts_family_inviter_fkey"
      FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "accounts_family_relation_ck"
      CHECK ("relation" IN ('parent', 'sibling', 'child', 'guardian', 'other')),
    CONSTRAINT "accounts_family_status_ck"
      CHECK ("status" IN ('pending', 'accepted', 'expired', 'revoked')),
    -- One live membership per (owner, member); pending rows have NULL member.
    CONSTRAINT "accounts_family_owner_member_key" UNIQUE ("profile_user_id", "member_user_id")
);
-- Single-use invite tokens (sha256-hashed, mirroring refresh-token storage).
CREATE UNIQUE INDEX "accounts_family_token_idx"
  ON "accounts_family"("invite_token_hash") WHERE "invite_token_hash" IS NOT NULL;
CREATE INDEX "accounts_family_member_idx" ON "accounts_family"("member_user_id")
  WHERE "member_user_id" IS NOT NULL;

CREATE TABLE "family_feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "family_account_id" UUID NOT NULL,
    "family_member_id" UUID NOT NULL,
    "profile_user_id" UUID NOT NULL,   -- the owner (denormalised for RLS)
    "candidate_id" UUID NOT NULL,
    "signal" TEXT NOT NULL,            -- closed vocabulary (CHECK below)
    "comment_enc" BYTEA,               -- C4 — field-level encryption at the service
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "family_feedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "family_feedback_account_fkey"
      FOREIGN KEY ("family_account_id") REFERENCES "accounts_family"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "family_feedback_member_fkey"
      FOREIGN KEY ("family_member_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "family_feedback_owner_fkey"
      FOREIGN KEY ("profile_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "family_feedback_candidate_fkey"
      FOREIGN KEY ("candidate_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "family_feedback_signal_ck"
      CHECK ("signal" IN ('approve', 'reject', 'interested', 'concern'))
);
CREATE INDEX "family_feedback_owner_idx" ON "family_feedback"("profile_user_id", "created_at");
CREATE INDEX "family_feedback_candidate_idx" ON "family_feedback"("candidate_id");

ALTER TABLE "accounts_family" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts_family" FORCE ROW LEVEL SECURITY;
-- Owner manages (reads) their family list; a member reads their own rows.
-- NO user-context writes — invites/accepts/revokes are service-context only,
-- so a family member can never grant themselves permissions (D7).
CREATE POLICY accounts_family_owner_select ON "accounts_family" FOR SELECT
  USING ("profile_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY accounts_family_member_select ON "accounts_family" FOR SELECT
  USING ("member_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY accounts_family_service_all ON "accounts_family" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

ALTER TABLE "family_feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "family_feedback" FORCE ROW LEVEL SECURITY;
CREATE POLICY family_feedback_owner_select ON "family_feedback" FOR SELECT
  USING ("profile_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY family_feedback_author_select ON "family_feedback" FOR SELECT
  USING ("family_member_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY family_feedback_service_all ON "family_feedback" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

GRANT SELECT, INSERT, UPDATE, DELETE ON "accounts_family" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "family_feedback" TO app_user;
