# ADR-0012: D3 resolved — local-first embeddings; pgvector compiled into the embedded-Postgres harness

**Status:** accepted · **Date:** 2026-10-25 · **Decides:** DESIGN.md D3 (embedding provider) · **Implements:** ADR-0009 deferral

## Context

P3 needs profile embeddings over normalised structured summaries (DESIGN.md §8: pgvector, `vector(1024)`, HNSW). Two open problems:

1. **D3 provider:** must support Indian languages and India-region processing. No third-party embedding API was approved, and sending profile data to an unvetted endpoint is a privacy (C2/C3) risk.
2. **Test harness:** migrations must run identically everywhere (ADR-0002). The dev box has no Docker and the `embedded-postgres` npm binaries are trimmed (no extensions, no headers, no `pg_config`). CI/dev would otherwise be unable to apply `CREATE EXTENSION vector`.

## Decision

- **Provider:** `EmbeddingProvider` port in `services/matching` (config: `EMBEDDING_PROVIDER`, rule 13). Default in dev/CI is a deterministic **hashing provider** (no deps, tests only); the real provider is a **local open-source multilingual model** (bge-m3, 1024-dim, Hindi-capable, runs fully on-prem → data residency satisfied; `local` value, stub until P3-02 wires the model). The hashing provider is refused in production by a factory guardrail + guardrail test (mirrors `config.ts` P0-12 rails).
- **Storage:** `profiles.embedding vector(1024)` via hand-written migration; read/written with hand-written SQL (Prisma `Unsupported`); written only by the new `save_embedding` internal tool (A2's allow-list). C2 data; inherits `profiles` RLS.
- **Harness (Track A — spike PASSED):** pgvector v0.8.0 is **compiled from source** against PostgreSQL 16.14 headers with the VS Build Tools and installed into the embedded binaries' `native/lib` + `native/share/extension`. The embedded binaries are MSVC-built (VCRUNTIME140/UCRT), ABI-compatible with the build. One-time, machine-local, git-ignored: `.tools/pgvector-spike/build-all.cmd`; `scripts/install-pgvector-embedded.cjs` copies the artifacts (idempotent) and is invoked by `test/global-setup.ts` and `scripts/e2e-serve.ts` before migrations. Cloud environments use `pgvector/pgvector:pg16` (extension preinstalled); `CREATE EXTENSION IF NOT EXISTS` is idempotent.
  - Notable environment fixes recorded in `.tools/pgvector-spike/README.md`: SDK headers from Microsoft's official NuGet packages (no admin; no Windows SDK installed on the box), uv-venv `PYTHONHOME` contamination, Git-usr `link.exe` shadowing MSVC, meson `find_meson` env, ARM64-host toolchain misdetecting the arch, MSYS-mangled `dumpbin` args in `gendef.pl`.

## Consequences

- The full test suite runs real pgvector (cosine `<=>`, HNSW `vector_cosine_ops`) on the exact harness recipe — no Docker needed, no schema forks.
- A fresh machine must run the one-time local build before tests (the installer fails loudly with instructions otherwise).
- The local embedding model (bge-m3 via sentence-transformers) is a P3-02 dev-extra dependency; CI keeps using the hashing provider.
- HNSW index (`vector_cosine_ops`) lands with retrieval (P3-04); embedding quality recall eval compares the real model against the hashing baseline (P3-02).
