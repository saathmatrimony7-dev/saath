-- P3-05: A5/A6 screening broker protocol (DESIGN.md A7.3/A7.4 + A9).
-- screening_results caches the broker verdict per pair + preference versions.
-- SERVICE CONTEXT ONLY (mirrors safety_cases): neither party ever reads their
-- own screening rows directly — verdicts surface through daily_matches under
-- the stricter of the two disclosure policies (A7.4.3). Pair order is
-- normalised (user_a < user_b) so a pair has exactly one cache row.
-- inputs_hash (sha256 of canonical snapshot+rules JSON, A7.4.6) makes every
-- verdict reproducible for dispute and bias audits.

CREATE TABLE "screening_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_a" UUID NOT NULL,
    "user_b" UUID NOT NULL,
    "pref_version_a" INTEGER NOT NULL,
    "pref_version_b" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "topics" JSONB NOT NULL,
    "reason_codes" TEXT[] NOT NULL,
    "model_version" TEXT NOT NULL,
    "inputs_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "screening_results_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "screening_results_user_a_fkey"
      FOREIGN KEY ("user_a") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "screening_results_user_b_fkey"
      FOREIGN KEY ("user_b") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "screening_results_pair_key" UNIQUE ("user_a", "user_b"),
    CONSTRAINT "screening_results_verdict_ck"
      CHECK ("verdict" IN ('COMPATIBLE', 'PARTIAL', 'INCOMPATIBLE')),
    CONSTRAINT "screening_results_score_ck" CHECK ("score" BETWEEN 0 AND 1),
    CONSTRAINT "screening_results_pref_version_ck"
      CHECK ("pref_version_a" >= 1 AND "pref_version_b" >= 1),
    CONSTRAINT "screening_results_inputs_hash_ck"
      CHECK ("inputs_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "screening_results_model_version_ck" CHECK (char_length("model_version") <= 32)
);
CREATE INDEX "screening_results_expiry_idx" ON "screening_results"("expires_at");

ALTER TABLE "screening_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "screening_results" FORCE ROW LEVEL SECURITY;
-- Deliberately no owner policy: screening verdicts are never readable by the
-- pair members directly (A7.4.3 visibility is enforced on the feed surface).
CREATE POLICY screening_results_service_all ON "screening_results" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

GRANT SELECT, INSERT, UPDATE ON "screening_results" TO app_user;
