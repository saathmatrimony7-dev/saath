-- P0-09: LLM Gateway audit table (DESIGN.md §9 llm_calls).

CREATE TABLE "llm_calls" (
    "id" UUID NOT NULL,
    "agent" TEXT NOT NULL,
    "user_id" UUID,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cost_paise" INTEGER NOT NULL DEFAULT 0,
    "trace_id" TEXT NOT NULL,
    "redaction_applied" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_calls_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "llm_calls_user_id_idx" ON "llm_calls"("user_id");
CREATE INDEX "llm_calls_created_at_idx" ON "llm_calls"("created_at");

-- Audit table: written by the llm-gateway service context only; no per-user
-- read path (audit access comes via the admin console with JIT, later).
ALTER TABLE "llm_calls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "llm_calls" FORCE ROW LEVEL SECURITY;

CREATE POLICY llm_calls_service_only ON "llm_calls"
  USING (current_setting('app.service', true) = 'llm-gateway')
  WITH CHECK (current_setting('app.service', true) = 'llm-gateway');

GRANT SELECT, INSERT ON "llm_calls" TO app_user;
