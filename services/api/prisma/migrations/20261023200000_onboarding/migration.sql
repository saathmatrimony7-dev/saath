-- P1-06: A1 onboarding interview state (DESIGN.md A12: sessions + SSE messages).
-- The interview transcript is user data: FORCE RLS, owner + service contexts.

CREATE TABLE "onboarding_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "turn_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "onboarding_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onboarding_sessions_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "onboarding_sessions_status_ck"
      CHECK ("status" IN ('in_progress', 'awaiting_confirm', 'confirmed', 'abandoned'))
);
CREATE INDEX "onboarding_sessions_user_idx" ON "onboarding_sessions"("user_id", "created_at" DESC);

CREATE TABLE "onboarding_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "onboarding_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onboarding_messages_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "onboarding_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "onboarding_messages_role_ck" CHECK ("role" IN ('user', 'assistant'))
);
CREATE INDEX "onboarding_messages_session_idx" ON "onboarding_messages"("session_id", "seq");

ALTER TABLE "onboarding_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY onboarding_sessions_select_own ON "onboarding_sessions" FOR SELECT
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY onboarding_sessions_insert_own ON "onboarding_sessions" FOR INSERT
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY onboarding_sessions_update_own ON "onboarding_sessions" FOR UPDATE
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY onboarding_sessions_service_all ON "onboarding_sessions" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

ALTER TABLE "onboarding_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY onboarding_messages_select_own ON "onboarding_messages" FOR SELECT
  USING (session_id IN (SELECT id FROM onboarding_sessions
    WHERE user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid));
CREATE POLICY onboarding_messages_insert_own ON "onboarding_messages" FOR INSERT
  WITH CHECK (session_id IN (SELECT id FROM onboarding_sessions
    WHERE user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid));
CREATE POLICY onboarding_messages_service_all ON "onboarding_messages" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

GRANT SELECT, INSERT, UPDATE ON "onboarding_sessions" TO app_user;
GRANT SELECT, INSERT ON "onboarding_messages" TO app_user;
