# ADR-0009: Profile embeddings deferred to P3 (matching pipeline)

**Status:** accepted · **Date:** 2026-10-24 · **Decided with:** owner (P1 plan, "Deferred" note; DESIGN.md D3 open)

## Context

DESIGN.md gives profiles an embedding column for semantic matching. Populating it needs the embedding model choice, the matching pipeline, and pgvector operationally present (extension migration, index tuning) — none of which exist in P1.

## Decision

- The vector column exists in the schema (per DESIGN.md §9) but is **not populated in P1**. No code path writes embeddings.
- Embeddings land with the P3 matching pipeline: model from config, batch job, pgvector index, and the recall eval that justifies the model choice.
- Until then, matching-relevant text stays in the structured, schema-validated profile fields (A2 output) — no semantic shortcuts.

## Consequences

- P1 ships without any LLM-embedding cost or pgvector operational burden.
- P3 must add the extension migration (embedded-PG test harness needs a pgvector build then — noted in P0 deferrals).
