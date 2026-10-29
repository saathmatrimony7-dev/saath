-- P5-01: DPDP data-principal requests (DESIGN.md §10.2) — access (export),
-- erase (deletion), grievance. Owner reads (and opens) their own requests;
-- staff workflows (grievance officer queue, the retention sweeper) run in
-- service contexts. Grievance text is C4 (FieldCrypto) in details_enc.

CREATE TABLE "dsr_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL, -- access | erase | grievance
    "status" TEXT NOT NULL DEFAULT 'open', -- open | in_progress | completed | cancelled
    "details_enc" BYTEA, -- grievance text (C4); NULL for access/erase
    "resolution" TEXT,
    "due_at" TIMESTAMPTZ NOT NULL,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "dsr_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dsr_requests_user_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "dsr_requests_type_ck" CHECK ("type" IN ('access', 'erase', 'grievance')),
    CONSTRAINT "dsr_requests_status_ck"
      CHECK ("status" IN ('open', 'in_progress', 'completed', 'cancelled'))
);

-- Grievance-officer queue: open grievances by SLA, erase backlog by due date.
CREATE INDEX "dsr_requests_user_idx" ON "dsr_requests"("user_id", "created_at" DESC);
CREATE INDEX "dsr_requests_queue_idx" ON "dsr_requests"("type", "status", "due_at");

ALTER TABLE "dsr_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dsr_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY dsr_requests_select_own ON "dsr_requests" FOR SELECT
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY dsr_requests_insert_own ON "dsr_requests" FOR INSERT
  WITH CHECK ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY dsr_requests_service_all ON "dsr_requests" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

GRANT SELECT, INSERT, UPDATE, DELETE ON "dsr_requests" TO app_user;

-- P5-01: the privacy service resolves users cross-user (export assembly,
-- erasure sweeper). Extend the pre-auth service lookup (SELECT-only).
DROP POLICY users_service_lookup ON "users";

CREATE POLICY users_service_lookup ON "users" FOR SELECT
  USING (current_setting('app.service', true) IN ('identity', 'channels', 'safety', 'admin', 'matching', 'messaging', 'billing', 'privacy'));

-- Erasure writes are scoped to the 'privacy' service context (same narrowed
-- precedent as users_admin_update): deactivation/anonymisation UPDATEs and
-- the retention hard-delete. DELETE on the identity table did not exist
-- before this migration — it is privacy-only, by design.
CREATE POLICY users_privacy_update ON "users" FOR UPDATE
  USING (current_setting('app.service', true) = 'privacy')
  WITH CHECK (current_setting('app.service', true) = 'privacy');
CREATE POLICY users_privacy_delete ON "users" FOR DELETE
  USING (current_setting('app.service', true) = 'privacy');

GRANT DELETE ON "users" TO app_user;
