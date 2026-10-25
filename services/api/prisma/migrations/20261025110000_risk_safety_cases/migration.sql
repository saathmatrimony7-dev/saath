-- P2-04: A3 risk scoring + the human review queue (DESIGN.md A6/A3 exit rule).
-- risk_scores: owner-readable, service writes. safety_cases: SERVICE CONTEXT
-- ONLY (no owner policy — deny by default; subjects never read their cases).

CREATE TABLE "risk_scores" (
    "user_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "signals" JSONB NOT NULL,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "risk_scores_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "risk_scores_user_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "safety_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "decision" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "safety_cases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "safety_cases_subject_fkey"
      FOREIGN KEY ("subject_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "safety_cases_source_ck"
      CHECK ("source" IN ('risk', 'report', 'kyc', 'moderation', 'a9')),
    CONSTRAINT "safety_cases_severity_ck"
      CHECK ("severity" IN ('low', 'medium', 'high', 'critical')),
    CONSTRAINT "safety_cases_status_ck"
      CHECK ("status" IN ('open', 'reviewing', 'resolved', 'dismissed'))
);
CREATE INDEX "safety_cases_subject_idx" ON "safety_cases"("subject_id", "status");
CREATE INDEX "safety_cases_queue_idx" ON "safety_cases"("status", "severity");

ALTER TABLE "risk_scores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "risk_scores" FORCE ROW LEVEL SECURITY;
CREATE POLICY risk_scores_select_own ON "risk_scores" FOR SELECT
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY risk_scores_service_all ON "risk_scores" FOR ALL
  USING (current_setting('app.service', true) = 'risk')
  WITH CHECK (current_setting('app.service', true) = 'risk');

ALTER TABLE "safety_cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_cases" FORCE ROW LEVEL SECURITY;
-- Deliberately no owner policy: subjects must not read their own cases.
CREATE POLICY safety_cases_service_all ON "safety_cases" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

GRANT SELECT, INSERT, UPDATE ON "risk_scores" TO app_user;
GRANT SELECT, INSERT, UPDATE ON "safety_cases" TO app_user;
