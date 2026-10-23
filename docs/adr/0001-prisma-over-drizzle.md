# ADR-0001: Prisma as the ORM (over Drizzle)

**Status:** accepted · **Date:** 2026-10-21 · **Decided with:** owner (P0 Q2)

## Context

DESIGN.md §4 lists "Prisma ORM (or Drizzle)". P0 needed a choice for the identity schema + RLS work.

## Decision

Prisma. RLS policies are written as hand-maintained SQL appended to Prisma migrations (Prisma does not manage RLS). Migrations run with the admin connection; the app connects as the non-superuser `app_login` role.

## Alternatives

- Drizzle: lighter, SQL-first; but team familiarity and NestJS ecosystem examples favoured Prisma, and AGENTS.md's stack line names Prisma.
- TypeORM: older decorator-heavy API; not considered seriously.

## Consequences

- Every migration touching a user-data table must include the RLS SQL by hand (ENABLE/FORCE + policies). The RLS test suite (`test/rls/`) catches omissions: a new table without policies fails the deny-by-default test pattern.
- `prisma migrate dev` needs a TTY; in scripts/CI use `migrate deploy` (hand-written migration files when creating them non-interactively).
