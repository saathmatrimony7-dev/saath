-- P3-07: daily feed rows (DESIGN.md §9) + nightly-batch indexes (§8 steps 1-2
-- run "on indexed columns" — the P3 benchmark exposed the missing ones).

CREATE TABLE "daily_matches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "batch_date" DATE NOT NULL,
    "rank" INTEGER NOT NULL,
    "explanation_i18n" JSONB, -- P3-09 (A4 explanations) lands here; NULL until then
    "status" TEXT NOT NULL DEFAULT 'published', -- published | viewed | acted (P3-08)
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "daily_matches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "daily_matches_user_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "daily_matches_candidate_fkey"
      FOREIGN KEY ("candidate_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "daily_matches_pair_key" UNIQUE ("user_id", "candidate_id", "batch_date"),
    CONSTRAINT "daily_matches_rank_ck" CHECK ("rank" >= 1),
    CONSTRAINT "daily_matches_status_ck"
      CHECK ("status" IN ('published', 'viewed', 'acted'))
);
CREATE INDEX "daily_matches_user_idx" ON "daily_matches"("user_id", "batch_date" DESC);
CREATE INDEX "daily_matches_candidate_idx" ON "daily_matches"("candidate_id", "batch_date");

ALTER TABLE "daily_matches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_matches" FORCE ROW LEVEL SECURITY;
-- The owner reads their own feed (P3-08); writes are service-context only.
CREATE POLICY daily_matches_select_own ON "daily_matches" FOR SELECT
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY daily_matches_service_all ON "daily_matches" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

GRANT SELECT, INSERT, UPDATE, DELETE ON "daily_matches" TO app_user;

-- Nightly-batch access paths (§8): pool ordering, block EXISTS both
-- directions, approved-photo EXISTS. Benchmark-measured, prod-needed.
CREATE INDEX "users_batch_pool_idx" ON "users"("status", "last_active_at" DESC);
CREATE INDEX "blocks_blocker_idx" ON "blocks"("blocker_id");
CREATE INDEX "photos_user_moderation_idx" ON "photos"("user_id", "moderation_status");
