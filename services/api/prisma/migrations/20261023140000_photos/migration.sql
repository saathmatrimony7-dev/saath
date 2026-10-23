-- P1-04: photos (DESIGN.md A1.9). Files live in object storage (S3 in cloud,
-- disk-backed mock locally); this table is the metadata + moderation ledger.
-- Served ONLY via short-lived HMAC-signed URLs — no public file endpoints.

CREATE TABLE "photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL DEFAULT 0,
    "phash" TEXT,
    "moderation_status" TEXT NOT NULL DEFAULT 'pending',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "blur_for_non_matches" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "photos_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "photos_moderation_status_ck"
      CHECK ("moderation_status" IN ('pending', 'approved', 'rejected'))
);
CREATE UNIQUE INDEX "photos_storage_key_key" ON "photos"("storage_key");
CREATE INDEX "photos_user_idx" ON "photos"("user_id");

ALTER TABLE "photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "photos" FORCE ROW LEVEL SECURITY;

CREATE POLICY photos_select_own ON "photos" FOR SELECT
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY photos_insert_own ON "photos" FOR INSERT
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY photos_update_own ON "photos" FOR UPDATE
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
CREATE POLICY photos_delete_own ON "photos" FOR DELETE
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- Agent/moderation workers reach photos only in service context.
CREATE POLICY photos_service_all ON "photos" FOR ALL
  USING (NULLIF(current_setting('app.service', true), '') <> '')
  WITH CHECK (NULLIF(current_setting('app.service', true), '') <> '');

GRANT SELECT, INSERT, UPDATE, DELETE ON "photos" TO app_user;
