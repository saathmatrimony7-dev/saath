-- P1-01: taxonomy + attribute definitions (DESIGN.md §1.3, §9).
-- Reference data: readable by every caller (SELECT policy USING true),
-- writable only by service/admin contexts (no write policy for app_user).

CREATE TABLE "taxonomy_religion" (
    "id" TEXT NOT NULL,
    "label_i18n" JSONB NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "taxonomy_religion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "taxonomy_community" (
    "id" TEXT NOT NULL,
    "religion_id" TEXT NOT NULL,
    "label_i18n" JSONB NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "taxonomy_community_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "taxonomy_community_religion_id_fkey"
      FOREIGN KEY ("religion_id") REFERENCES "taxonomy_religion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "taxonomy_sub_community" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "label_i18n" JSONB NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "taxonomy_sub_community_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "taxonomy_sub_community_community_id_fkey"
      FOREIGN KEY ("community_id") REFERENCES "taxonomy_community"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "taxonomy_city" (
    "id" TEXT NOT NULL,
    "label_i18n" JSONB NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    CONSTRAINT "taxonomy_city_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attribute_definitions" (
    "key" TEXT NOT NULL,
    "community_scope" TEXT,
    "type" TEXT NOT NULL,
    "options" JSONB,
    "sensitivity" TEXT NOT NULL DEFAULT 'C3',
    "label_i18n" JSONB NOT NULL,
    CONSTRAINT "attribute_definitions_pkey" PRIMARY KEY ("key")
);

-- RLS: FORCE on all; SELECT open to any role, writes service-only (grant stays
-- with the migration/admin role — app_user gets SELECT only).
ALTER TABLE "taxonomy_religion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "taxonomy_religion" FORCE ROW LEVEL SECURITY;
CREATE POLICY taxonomy_religion_read_all ON "taxonomy_religion" FOR SELECT USING (true);

ALTER TABLE "taxonomy_community" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "taxonomy_community" FORCE ROW LEVEL SECURITY;
CREATE POLICY taxonomy_community_read_all ON "taxonomy_community" FOR SELECT USING (true);

ALTER TABLE "taxonomy_sub_community" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "taxonomy_sub_community" FORCE ROW LEVEL SECURITY;
CREATE POLICY taxonomy_sub_community_read_all ON "taxonomy_sub_community" FOR SELECT USING (true);

ALTER TABLE "taxonomy_city" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "taxonomy_city" FORCE ROW LEVEL SECURITY;
CREATE POLICY taxonomy_city_read_all ON "taxonomy_city" FOR SELECT USING (true);

ALTER TABLE "attribute_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attribute_definitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY attribute_definitions_read_all ON "attribute_definitions" FOR SELECT USING (true);

GRANT SELECT ON "taxonomy_religion" TO app_user;
GRANT SELECT ON "taxonomy_community" TO app_user;
GRANT SELECT ON "taxonomy_sub_community" TO app_user;
GRANT SELECT ON "taxonomy_city" TO app_user;
GRANT SELECT ON "attribute_definitions" TO app_user;
