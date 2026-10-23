# ADR-0002: Local dev/test database — embedded Postgres (no Docker dependency)

**Status:** accepted · **Date:** 2026-10-21 · **Decided with:** owner (P0 Q1/Q7)

## Context

Docker Desktop is not installed on the dev machine; AWS accounts don't exist yet (plan-only Terraform). P0's RLS exit criterion needs a real Postgres 16.

## Decision

- **Tests + local dev:** `embedded-postgres` (real PG 16 binaries, no admin rights) — `services/api/scripts/dev-db.ts` for a persistent dev instance, `test/global-setup.ts` for an ephemeral per-run instance on a random free port.
- **Docker Compose** (`infra/docker/`, pgvector image) remains available for machines that have Docker.
- **Cloud:** Terraform-managed RDS (unchanged).

Two roles: migrations/admin use the superuser; the app and ALL tests use `app_login` (NOSUPERUSER) because **superusers bypass RLS unconditionally** — testing as superuser would silently void the exit criterion.

## Consequences

- pgvector is not present in embedded binaries; the `CREATE EXTENSION vector` migration must be gated or run where the extension exists (relevant from P3). Compose/RDS images include it.
- Test DB URLs are shared with workers via a temp file (worker processes can't see the setup process's env).
