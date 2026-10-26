-- P3-04: HNSW ANN index over profiles.embedding for retrieval
-- (DESIGN.md §8 step 3; ADR-0012 deferred "HNSW lands with retrieval").
-- vector_cosine_ops matches the retrieval query's `<=>` operator.
--
-- The exact fallback remains correct when this index is absent: the retrieval
-- query is a plain `ORDER BY embedding <=> $q LIMIT k`, which the planner
-- executes as an exact sequential scan (small tables, embedded Postgres
-- before the installer runs, or any environment where CREATE INDEX failed).
-- HNSW only changes the access path, never the result semantics.

CREATE INDEX IF NOT EXISTS "profiles_embedding_hnsw_idx"
  ON "profiles" USING hnsw ("embedding" vector_cosine_ops);
