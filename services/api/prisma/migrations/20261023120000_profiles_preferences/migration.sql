-- P1-03: profiles + preferences (DESIGN.md A1.9). User-selected reference-data
-- columns (religion/community/sub-community/city) are FKs into the taxonomy —
-- the user SELF-selects from curated lists; nothing is ever inferred (rule 10).
-- Embedding deferred to P2 (P1-12 ADR).

-- ---------------------------------------------------------------------------
-- profiles: one row per user; profile_version bumps on every write (optimistic
-- concurrency + audit trail for matching snapshots later).
-- ---------------------------------------------------------------------------
CREATE TABLE "profiles" (
    "user_id" UUID NOT NULL,
    "display_name" TEXT,
    "about_normalised" TEXT,
    "height_cm" SMALLINT,
    "marital_status" TEXT,
    "has_children" BOOLEAN NOT NULL DEFAULT false,
    "diet" TEXT,
    "education_level" TEXT,
    "profession" TEXT,
    "income_band" TEXT,
    "city_id" TEXT,
    "willing_to_relocate" BOOLEAN,
    "religion_id" TEXT,
    "community_id" TEXT,
    "sub_community_id" TEXT,
    "mother_tongue" TEXT, -- ISO 639 code; language taxonomy arrives with admin data
    "visibility" TEXT NOT NULL DEFAULT 'members',
    "verification_tier" SMALLINT NOT NULL DEFAULT 0,
    "profile_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "profiles_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "profiles_city_id_fkey"
      FOREIGN KEY ("city_id") REFERENCES "taxonomy_city"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "profiles_religion_id_fkey"
      FOREIGN KEY ("religion_id") REFERENCES "taxonomy_religion"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "profiles_community_id_fkey"
      FOREIGN KEY ("community_id") REFERENCES "taxonomy_community"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "profiles_sub_community_id_fkey"
      FOREIGN KEY ("sub_community_id") REFERENCES "taxonomy_sub_community"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Community-specific attributes (gotra, manglik…), validated against
-- attribute_definitions in the service layer. visibility per row.
CREATE TABLE "profile_attributes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "attribute_key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'matches_only',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "profile_attributes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "profile_attributes_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "profile_attributes_key_fkey"
      FOREIGN KEY ("attribute_key") REFERENCES "attribute_definitions"("key") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "profile_attributes_user_idx" ON "profile_attributes"("user_id", "attribute_key");

-- ---------------------------------------------------------------------------
-- preferences / dealbreakers / soft_preferences / disclosure_policies.
-- dealbreakers is a per-user REPLACE set (PUT semantics in the API).
-- ---------------------------------------------------------------------------
CREATE TABLE "preferences" (
    "user_id" UUID NOT NULL,
    "age_min" SMALLINT,
    "age_max" SMALLINT,
    "height_min" SMALLINT,
    "cities" TEXT[] NOT NULL DEFAULT '{}',
    "relocate_ok" BOOLEAN,
    "community_filter" JSONB,
    "open_to_all_communities" BOOLEAN NOT NULL DEFAULT true,
    "diet_ok" TEXT[] NOT NULL DEFAULT '{}',
    "marital_ok" TEXT[] NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "preferences_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "preferences_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "dealbreakers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "rule" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "dealbreakers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dealbreakers_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "dealbreakers_user_idx" ON "dealbreakers"("user_id");

CREATE TABLE "soft_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "stance_normalised" TEXT NOT NULL,
    "weight" SMALLINT NOT NULL DEFAULT 50,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "soft_preferences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "soft_preferences_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "soft_preferences_weight_ck" CHECK ("weight" BETWEEN 0 AND 100)
);
CREATE INDEX "soft_preferences_user_idx" ON "soft_preferences"("user_id", "topic");

CREATE TABLE "disclosure_policies" (
    "user_id" UUID NOT NULL,
    "share_level" TEXT NOT NULL DEFAULT 'standard',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "disclosure_policies_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "disclosure_policies_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "disclosure_policies_level_ck"
      CHECK ("share_level" IN ('minimal', 'standard', 'detailed'))
);

-- ---------------------------------------------------------------------------
-- RLS: FORCE on all six; owner-scoped NULLIF-GUC policies + service context
-- (agents reach user data only through Core API tool endpoints, P1-05).
-- ---------------------------------------------------------------------------
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY profiles_select_own ON "profiles" FOR SELECT
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY profiles_insert_own ON "profiles" FOR INSERT
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY profiles_update_own ON "profiles" FOR UPDATE
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

ALTER TABLE "profile_attributes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profile_attributes" FORCE ROW LEVEL SECURITY;
CREATE POLICY profile_attributes_select_own ON "profile_attributes" FOR SELECT
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY profile_attributes_insert_own ON "profile_attributes" FOR INSERT
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY profile_attributes_update_own ON "profile_attributes" FOR UPDATE
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY profile_attributes_delete_own ON "profile_attributes" FOR DELETE
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

ALTER TABLE "preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "preferences" FORCE ROW LEVEL SECURITY;
CREATE POLICY preferences_select_own ON "preferences" FOR SELECT
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY preferences_insert_own ON "preferences" FOR INSERT
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY preferences_update_own ON "preferences" FOR UPDATE
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

ALTER TABLE "dealbreakers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dealbreakers" FORCE ROW LEVEL SECURITY;
CREATE POLICY dealbreakers_select_own ON "dealbreakers" FOR SELECT
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY dealbreakers_insert_own ON "dealbreakers" FOR INSERT
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY dealbreakers_update_own ON "dealbreakers" FOR UPDATE
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY dealbreakers_delete_own ON "dealbreakers" FOR DELETE
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

ALTER TABLE "soft_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "soft_preferences" FORCE ROW LEVEL SECURITY;
CREATE POLICY soft_preferences_select_own ON "soft_preferences" FOR SELECT
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY soft_preferences_insert_own ON "soft_preferences" FOR INSERT
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY soft_preferences_update_own ON "soft_preferences" FOR UPDATE
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY soft_preferences_delete_own ON "soft_preferences" FOR DELETE
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

ALTER TABLE "disclosure_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "disclosure_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY disclosure_policies_select_own ON "disclosure_policies" FOR SELECT
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY disclosure_policies_insert_own ON "disclosure_policies" FOR INSERT
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY disclosure_policies_update_own ON "disclosure_policies" FOR UPDATE
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- Service context for all six (agent tool endpoints act with scoped tokens).
CREATE POLICY profiles_service_all ON "profiles" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');
CREATE POLICY profile_attributes_service_all ON "profile_attributes" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');
CREATE POLICY preferences_service_all ON "preferences" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');
CREATE POLICY dealbreakers_service_all ON "dealbreakers" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');
CREATE POLICY soft_preferences_service_all ON "soft_preferences" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');
CREATE POLICY disclosure_policies_service_all ON "disclosure_policies" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

GRANT SELECT, INSERT, UPDATE, DELETE ON "profiles" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "profile_attributes" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "preferences" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "dealbreakers" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "soft_preferences" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "disclosure_policies" TO app_user;
