-- P2-03: reports & blocks (DESIGN.md J9/T8). Owner-scoped RLS; the app role
-- appends reports (no UPDATE/DELETE — status changes are moderator/service
-- context only, admin console P2-06).

CREATE TABLE "blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "blocks_blocker_fkey"
      FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "blocks_blocked_fkey"
      FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "blocks_pair_uk" UNIQUE ("blocker_id", "blocked_id"),
    CONSTRAINT "blocks_no_self_ck" CHECK ("blocker_id" <> "blocked_id")
);
CREATE INDEX "blocks_blocked_idx" ON "blocks"("blocked_id");

CREATE TABLE "user_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reporter_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "details" VARCHAR(1000),
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "user_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_reports_reporter_fkey"
      FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_reports_subject_fkey"
      FOREIGN KEY ("subject_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_reports_reason_ck"
      CHECK ("reason" IN ('harassment', 'scam', 'fake_profile', 'inappropriate_content', 'underage', 'other')),
    CONSTRAINT "user_reports_status_ck"
      CHECK ("status" IN ('open', 'reviewing', 'resolved', 'dismissed'))
);
CREATE INDEX "user_reports_subject_idx" ON "user_reports"("subject_id", "status");
CREATE INDEX "user_reports_reporter_idx" ON "user_reports"("reporter_id");

ALTER TABLE "blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blocks" FORCE ROW LEVEL SECURITY;
CREATE POLICY blocks_select_own ON "blocks" FOR SELECT
  USING (blocker_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY blocks_insert_own ON "blocks" FOR INSERT
  WITH CHECK (blocker_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY blocks_delete_own ON "blocks" FOR DELETE
  USING (blocker_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
-- Moderation tooling (admin console) needs the full view in the service context.
CREATE POLICY blocks_service_all ON "blocks" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

ALTER TABLE "user_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_reports" FORCE ROW LEVEL SECURITY;
CREATE POLICY user_reports_select_own ON "user_reports" FOR SELECT
  USING (reporter_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
-- Append-only for the app role: reporters file; only the service context
-- (moderation/admin) may change status.
CREATE POLICY user_reports_insert_own ON "user_reports" FOR INSERT
  WITH CHECK (reporter_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY user_reports_service_all ON "user_reports" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

GRANT SELECT, INSERT, DELETE ON "blocks" TO app_user;
GRANT SELECT, INSERT ON "user_reports" TO app_user;
