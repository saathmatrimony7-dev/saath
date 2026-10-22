# services/api — Saath Core API (NestJS modular monolith)

Modules live in `src/modules/*` (DESIGN.md §5). Each module owns its tables.

## Local development

Two Postgres options (both are fine; the DB is synthetic-data-only):

**A. Embedded (no Docker):**

```bash
pnpm db:dev          # starts Postgres 16 on :55433, keeps running; Ctrl+C to stop
# first time only, in another terminal:
DATABASE_URL=postgresql://saath:saath_dev_password@127.0.0.1:55433/postgres pnpm exec prisma migrate deploy
pnpm db:dev          # restart once, to enable the app_login role
```

**B. Docker Compose:** `make db-up` (root) — Postgres 16 + pgvector on :5432, roles auto-created by `infra/docker/init/`.

Then, in your git-ignored `.env` (see `.env.example`):

```
DATABASE_URL=postgresql://app_login:app_login_dev_password@127.0.0.1:55433/postgres
```

> **Always connect the app as `app_login`, never the superuser.** Postgres
> superusers bypass RLS unconditionally — using one silently disables the
> row-isolation guarantees (and their tests).

## Commands

```bash
pnpm dev            # API with watch mode (tsx)
pnpm db:migrate     # prisma migrate deploy (uses DATABASE_URL)
pnpm db:seed        # synthetic seed (RLS-checked inserts)
pnpm test           # vitest: RLS integration + authz matrix (ephemeral PG on :55434)
pnpm test:rls       # just the RLS proofs
pnpm test:authz     # authorisation matrix (nightly CI job)
pnpm lint / typecheck
```

## RLS contract

Every user-data table has `ENABLE` + `FORCE ROW LEVEL SECURITY`. Requests run
through `PrismaService.withUser(userId, fn)` which sets
`app.current_user_id` transaction-locally. Unset context ⇒ zero rows.
Migrations own the policies (raw SQL appended to migration files — Prisma
doesn't manage RLS).
