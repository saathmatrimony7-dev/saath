-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone_e164_hash" TEXT NOT NULL,
    "phone_enc" BYTEA,
    "email_enc" BYTEA,
    "status" TEXT NOT NULL DEFAULT 'active',
    "age_verified" BOOLEAN NOT NULL DEFAULT false,
    "birth_year" SMALLINT,
    "gender" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "created_via" TEXT NOT NULL DEFAULT 'self',
    "last_active_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" TEXT,
    "refresh_token_hash" TEXT NOT NULL,
    "ip_hash" TEXT,
    "ua" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_e164_hash_key" ON "users"("phone_e164_hash");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security (DESIGN.md §9, §12.1 T4).
-- Every user-data table has RLS ENABLEd and FORCEd (the table owner is also
-- subject to policies). The API sets `app.current_user_id` transaction-locally
-- via `set_config(...)` before touching user data. If the GUC is unset, the
-- `NULL::uuid` comparison yields no rows — deny by default.
-- Prisma does not manage RLS; this SQL is maintained by hand.
-- ---------------------------------------------------------------------------

-- Application roles (defence in depth with service-layer authorisation).
--   app_user  — NOLOGIN group role holding table grants.
--   app_login — the role the API connects as. NOLOGIN here; each environment
--               enables login with its own password OUTSIDE migrations
--               (local: scripts/dev-db.ts or docker init; cloud: provisioned
--               with the password from Secrets Manager). No passwords in git.
-- NOTE: app_login is NOSUPERUSER — superusers bypass RLS unconditionally,
-- which would silently defeat these policies.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_login') THEN
    CREATE ROLE app_login NOLOGIN NOSUPERUSER IN ROLE app_user;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE ON "users" TO app_user;
GRANT SELECT, INSERT, UPDATE ON "sessions" TO app_user;

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

CREATE POLICY users_select_own ON "users" FOR SELECT
  USING (id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY users_insert_own ON "users" FOR INSERT
  WITH CHECK (id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY users_update_own ON "users" FOR UPDATE
  USING (id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;

CREATE POLICY sessions_select_own ON "sessions" FOR SELECT
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY sessions_insert_own ON "sessions" FOR INSERT
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY sessions_update_own ON "sessions" FOR UPDATE
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
