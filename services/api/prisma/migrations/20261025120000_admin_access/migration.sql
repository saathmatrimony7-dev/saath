-- P2-06: admin access model (DESIGN.md A12.2 T7): RBAC role on users, JIT
-- elevations with expiry, and an APPEND-ONLY admin audit trail.
-- C4 masking is enforced in the service layer (never decrypt *_enc for admin
-- responses); the audit log stores ids/kinds only — no record contents.

ALTER TABLE "users" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'member';
ALTER TABLE "users"
  ADD CONSTRAINT "users_role_ck"
  CHECK ("role" IN ('member', 'support', 'moderator', 'admin', 'superadmin'));

CREATE TABLE "admin_elevations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "granted_by" UUID NOT NULL, -- self in solo mode (logged, flagged)
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "admin_elevations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admin_elevations_user_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "admin_elevations_user_idx" ON "admin_elevations"("user_id", "expires_at");

CREATE TABLE "admin_audit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID NOT NULL,
    "action" TEXT NOT NULL, -- admin.view.* | admin.action.*
    "subject_kind" TEXT NOT NULL, -- user | case | audit | elevation | session
    "subject_id" TEXT, -- nullable for list views
    "meta" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "admin_audit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admin_audit_actor_fkey"
      FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "admin_audit_actor_idx" ON "admin_audit"("actor_id", "created_at" DESC);
CREATE INDEX "admin_audit_subject_idx" ON "admin_audit"("subject_kind", "subject_id");

ALTER TABLE "admin_elevations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_elevations" FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_elevations_select_own ON "admin_elevations" FOR SELECT
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY admin_elevations_service_all ON "admin_elevations" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

ALTER TABLE "admin_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_audit" FORCE ROW LEVEL SECURITY;
-- Append-only: SELECT+INSERT only, service context (admin acts through the
-- service layer). No owner policy — admins read the log via /v1/admin/audit.
CREATE POLICY admin_audit_service_all ON "admin_audit" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

GRANT SELECT, INSERT, UPDATE ON "admin_elevations" TO app_user;
GRANT SELECT, INSERT ON "admin_audit" TO app_user;
