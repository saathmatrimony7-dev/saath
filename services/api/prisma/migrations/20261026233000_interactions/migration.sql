-- P3-08: interactions (DESIGN.md §9) — likes / passes / shortlists for the
-- daily feed (family comments land with P3-10). Owner reads their OWN rows
-- only: a target user must never learn who liked/passed them — reveal happens
-- only via mutual match (P4). Writes are service-context only (feed gates,
-- disposition flips, entitlement counts).

CREATE TABLE "interactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "type" TEXT NOT NULL, -- like | pass | shortlist
    "reason_code" TEXT,   -- pass only, closed vocabulary (CHECK below)
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "interactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "interactions_actor_fkey"
      FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "interactions_target_fkey"
      FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "interactions_type_ck" CHECK ("type" IN ('like', 'pass', 'shortlist')),
    -- Closed pass-reason vocabulary (mirrors the P3-08 DTO; DB-level backstop).
    CONSTRAINT "interactions_pass_reason_ck"
      CHECK ("type" <> 'pass' OR "reason_code" IS NULL OR "reason_code" IN
            ('not_interested', 'too_far', 'profile_insufficient', 'other')),
    CONSTRAINT "interactions_actor_target_type_key" UNIQUE ("actor_user_id", "target_user_id", "type")
);
-- Entitlement counts per actor (+ pass-suppression lookups keyed by actor).
CREATE INDEX "interactions_actor_idx" ON "interactions"("actor_user_id", "type", "created_at");
-- Reverse lookups (future surfaces; feed gates key on actor, kept symmetric).
CREATE INDEX "interactions_target_idx" ON "interactions"("target_user_id", "type");

ALTER TABLE "interactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "interactions" FORCE ROW LEVEL SECURITY;
-- The actor sees their own disposition rows; the target sees nothing.
CREATE POLICY interactions_select_own ON "interactions" FOR SELECT
  USING ("actor_user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY interactions_service_all ON "interactions" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

GRANT SELECT, INSERT, UPDATE, DELETE ON "interactions" TO app_user;
