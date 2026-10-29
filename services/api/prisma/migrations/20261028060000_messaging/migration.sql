-- P4-01: messaging (DESIGN.md §9 messaging + §14) — mutual-match chat with
-- C4-encrypted bodies, masked calls, in-app notifications.
-- Participants see their own conversations/messages/calls/notifications;
-- writes are service-context only. Chat bodies are C4: body_enc (FieldCrypto),
-- and the pre-send contact-mask scanner lives in Core (P4-02).

CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_a" UUID NOT NULL,
    "user_b" UUID NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'mutual', -- mutual | intro (P4-06 intro pack)
    "status" TEXT NOT NULL DEFAULT 'open',   -- open | closed
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "contact_share_a" BOOLEAN NOT NULL DEFAULT false,
    "contact_share_b" BOOLEAN NOT NULL DEFAULT false,
    "contact_shared_at" TIMESTAMPTZ,
    "last_message_at" TIMESTAMPTZ,
    -- A8 coordinator (P4-09): proposed call/meet slots (ISO strings) and the
    -- latest post-meeting feedback (notes are C4-encrypted base64 by Core).
    "proposed_slots" JSONB,
    "meeting_feedback" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversations_user_a_fkey"
      FOREIGN KEY ("user_a") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "conversations_user_b_fkey"
      FOREIGN KEY ("user_b") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "conversations_origin_ck" CHECK ("origin" IN ('mutual', 'intro')),
    CONSTRAINT "conversations_status_ck" CHECK ("status" IN ('open', 'closed')),
    -- (user_a, user_b) is canonical: user_a's uuid sorts before user_b's
    -- (enforced by the service on open), so one row per unordered pair.
    CONSTRAINT "conversations_pair_key" UNIQUE ("user_a", "user_b"),
    CONSTRAINT "conversations_order_ck" CHECK ("user_a" < "user_b")
);

CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "body_enc" BYTEA NOT NULL, -- C4 (FieldCrypto); plaintext never touches the DB
    "moderation_status" TEXT NOT NULL DEFAULT 'pending', -- pending | clean | flagged
    "client_ref" TEXT, -- client idempotency key (unique per sender)
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messages_conversation_fkey"
      FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "messages_sender_fkey"
      FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "messages_moderation_ck"
      CHECK ("moderation_status" IN ('pending', 'clean', 'flagged')),
    CONSTRAINT "messages_sender_ref_key" UNIQUE ("sender_id", "client_ref")
);

CREATE TABLE "call_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "initiated_by" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mock', -- mock | exotel (D2 provider interface)
    "provider_ref" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'initiated', -- initiated|ongoing|completed|failed|declined
    "started_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,
    "duration_s" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "call_sessions_conversation_fkey"
      FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "call_sessions_initiator_fkey"
      FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "call_sessions_status_ck"
      CHECK ("status" IN ('initiated', 'ongoing', 'completed', 'failed', 'declined'))
);

CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL, -- match.mutual | message.received | subscription.activated
    "payload" JSONB NOT NULL DEFAULT '{}', -- closed-vocabulary jsonb, no C3/C4
    "channel" TEXT NOT NULL DEFAULT 'inapp',
    "read_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_user_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notifications_type_ck"
      CHECK ("type" IN ('match.mutual', 'message.received', 'subscription.activated',
                        'intro_pack.credited', 'coordinator.suggestion'))
);

CREATE TABLE "notification_settings" (
    "user_id" UUID NOT NULL,
    "quiet_start_min" INTEGER NOT NULL DEFAULT 1320, -- 22:00 IST (§14)
    "quiet_end_min" INTEGER NOT NULL DEFAULT 480,    -- 08:00 IST
    "daily_cap" INTEGER NOT NULL DEFAULT 5,
    "channels" JSONB NOT NULL DEFAULT '{"inapp":true,"whatsapp":false}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "notification_settings_user_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notification_settings_quiet_ck"
      CHECK ("quiet_start_min" BETWEEN 0 AND 1439 AND "quiet_end_min" BETWEEN 0 AND 1439),
    CONSTRAINT "notification_settings_cap_ck" CHECK ("daily_cap" >= 0)
);

-- Access paths: conversation lists per participant, message pages per
-- conversation, call log per conversation, notification feed per user.
CREATE INDEX "conversations_user_a_idx" ON "conversations"("user_a", "last_message_at" DESC);
CREATE INDEX "conversations_user_b_idx" ON "conversations"("user_b", "last_message_at" DESC);
CREATE INDEX "messages_conversation_idx" ON "messages"("conversation_id", "created_at");
CREATE INDEX "call_sessions_conversation_idx" ON "call_sessions"("conversation_id", "created_at");
CREATE INDEX "notifications_user_idx" ON "notifications"("user_id", "created_at" DESC);

ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
CREATE POLICY conversations_select_participant ON "conversations" FOR SELECT
  USING ("user_a" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      OR "user_b" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY conversations_service_all ON "conversations" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
-- A participant reads a conversation's messages; a sender inserts their own
-- (the service re-checks participant status + masking before the write).
CREATE POLICY messages_select_participant ON "messages" FOR SELECT
  USING (EXISTS (
      SELECT 1 FROM "conversations" c
       WHERE c."id" = "conversation_id"
         AND (c."user_a" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
           OR c."user_b" = NULLIF(current_setting('app.current_user_id', true), '')::uuid)));
CREATE POLICY messages_insert_sender ON "messages" FOR INSERT
  WITH CHECK ("sender_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
          AND EXISTS (
      SELECT 1 FROM "conversations" c
       WHERE c."id" = "conversation_id"
         AND (c."user_a" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
           OR c."user_b" = NULLIF(current_setting('app.current_user_id', true), '')::uuid)));
CREATE POLICY messages_service_all ON "messages" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

ALTER TABLE "call_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "call_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY call_sessions_select_participant ON "call_sessions" FOR SELECT
  USING (EXISTS (
      SELECT 1 FROM "conversations" c
       WHERE c."id" = "conversation_id"
         AND (c."user_a" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
           OR c."user_b" = NULLIF(current_setting('app.current_user_id', true), '')::uuid)));
CREATE POLICY call_sessions_service_all ON "call_sessions" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_select_own ON "notifications" FOR SELECT
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY notifications_update_own ON "notifications" FOR UPDATE
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY notifications_service_all ON "notifications" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

ALTER TABLE "notification_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_settings_select_own ON "notification_settings" FOR SELECT
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY notification_settings_write_own ON "notification_settings" FOR INSERT
  WITH CHECK ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY notification_settings_update_own ON "notification_settings" FOR UPDATE
  USING ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK ("user_id" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY notification_settings_service_all ON "notification_settings" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

GRANT SELECT, INSERT, UPDATE, DELETE ON "conversations" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "messages" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "call_sessions" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "notifications" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_settings" TO app_user;

-- P4-02: the messaging service resolves users cross-user (recipient status,
-- blocked-pair gate). Extend the pre-auth service lookup (same exposure
-- class as matching); SELECT-only.
DROP POLICY users_service_lookup ON "users";

CREATE POLICY users_service_lookup ON "users" FOR SELECT
  USING (current_setting('app.service', true) IN ('identity', 'channels', 'safety', 'admin', 'matching', 'messaging', 'billing'));
