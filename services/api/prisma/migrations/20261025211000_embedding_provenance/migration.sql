-- P3-02: embedding provenance on profiles (DESIGN.md §8; ADR-0012).
-- Records WHICH normalised summary (sha256), WHICH model, and WHICH
-- profile/preference versions produced the stored embedding — the nightly
-- re-embed sweep (listStaleEmbeddings) diffs these against the live versions.
-- Regular columns (not the Unsupported pgvector one): plain Prisma fields.
-- C2 classification: inherits the profiles RLS policies (C2); no policy
-- changes needed — column-level security is not used.

ALTER TABLE "profiles"
  ADD COLUMN "embedding_summary_hash" TEXT,
  ADD COLUMN "embedding_model_version" TEXT,
  ADD COLUMN "embedding_profile_version" INTEGER,
  ADD COLUMN "embedding_pref_version" INTEGER,
  ADD COLUMN "embedding_updated_at" TIMESTAMPTZ;

COMMENT ON COLUMN "profiles"."embedding_summary_hash" IS
  'P3-02: sha256 of the rendered normalised summary text that was embedded (provenance).';
COMMENT ON COLUMN "profiles"."embedding_model_version" IS
  'P3-02: embedding model identifier (e.g. BAAI/bge-m3 or hash-embed-v1).';
COMMENT ON COLUMN "profiles"."embedding_profile_version" IS
  'P3-02: profiles.profile_version at embed time; NULL = never embedded with provenance.';
COMMENT ON COLUMN "profiles"."embedding_pref_version" IS
  'P3-02: preferences.version at embed time.';
COMMENT ON COLUMN "profiles"."embedding_updated_at" IS
  'P3-02: last embedding write timestamp.';
