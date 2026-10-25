-- P1-09: idempotent webhook processing (DESIGN.md §12 — verify signature,
-- store event_id, ignore replays).
-- Operational table: vendor message ids only, no user content. Service-only
-- by design (ADR-0001 scope: RLS policies cover user-data tables).

CREATE TABLE "webhook_events" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- Idempotency needs SELECT (dedupe check) + INSERT; no UPDATE/DELETE.
GRANT SELECT, INSERT ON "webhook_events" TO app_user;
