-- P3-01: profile embeddings (DESIGN.md §8/§9; ADR-0009 deferral resolved).
-- The column stores the embedding of the A2-normalised STRUCTURED SUMMARY
-- (never raw bio text, rule 6/§8). Written only via the save_embedding
-- internal tool (A2). C2 classification (§10.1): RLS through profiles
-- policies; not C4 — no field-level encryption needed.
--
-- pgvector: pre-provisioned in cloud images (pgvector/pgvector:pg16 or PGDG
-- postgresql-16-pgvector). Local embedded Postgres gets a locally-BUILT
-- vector.dll installed by scripts/install-pgvector-embedded.mjs before
-- migrations run (ADR-0012). CREATE EXTENSION is idempotent.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "profiles" ADD COLUMN "embedding" vector(1024);

COMMENT ON COLUMN "profiles"."embedding" IS
  'C2: embedding of the A2-normalised structured profile summary (never raw bio). Written only via the save_embedding internal tool.';

-- HNSW ANN index lands with the retrieval step (P3-04, vector_cosine_ops).
