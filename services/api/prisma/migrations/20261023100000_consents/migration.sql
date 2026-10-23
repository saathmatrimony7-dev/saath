-- P1-02: consent ledger (DESIGN.md A6 — privacy consent, exit "consents recorded").
-- APPEND-ONLY by design: the app role gets SELECT + INSERT only. Withdrawal is
-- a NEW row (granted = false), never an UPDATE/DELETE — the audit trail is the
-- feature. Purposes: matchmaking, agent_screening, family_mode, whatsapp, kyc,
-- marketing (enforced in the service layer; see consent.consts.ts).

CREATE TABLE "consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "notice_version" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'app',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "consents_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Latest-state lookup per (user, purpose).
CREATE INDEX "consents_user_purpose_idx" ON "consents"("user_id", "purpose", "created_at" DESC);

ALTER TABLE "consents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consents" FORCE ROW LEVEL SECURITY;

-- Owner reads their own ledger.
CREATE POLICY consents_select_own ON "consents" FOR SELECT
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- Owner appends their own rows (grant consent, withdraw consent, re-grant).
CREATE POLICY consents_insert_own ON "consents" FOR INSERT
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- Services (identity at signup, agents at screening time) may read/append in
-- the service context; no UPDATE/DELETE policy exists for anyone but the
-- table owner (migration/admin role).
CREATE POLICY consents_service_all ON "consents" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

-- Append-only for application traffic: INSERT + SELECT only. NO UPDATE/DELETE.
GRANT SELECT, INSERT ON "consents" TO app_user;
