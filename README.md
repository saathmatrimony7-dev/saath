# Saath — Agentic AI Matrimony Platform

Monorepo for the Saath MVP. **Source of truth: `docs/DESIGN.md`** (architecture, data model, agents, security, phases). Working rules: `AGENTS.md` / `CLAUDE.md`.

## Layout (DESIGN.md §18)

```
apps/web, apps/admin     # Next.js (placeholders — frontend starts in P1)
services/api             # NestJS modular monolith (Core API)
services/agents          # Python 3.12 FastAPI agents (A1–A11) + LLM Gateway client
services/matching        # Python matching pipeline workers
packages/api-client      # generated TS client from OpenAPI
packages/ui              # shared components
packages/i18n            # translation files (10 Indian languages + English)
packages/config          # shared eslint / tsconfig / prettier
infra/terraform          # envs dev|staging|prod + modules
infra/docker             # local dev datastores (Postgres 16 + pgvector, Redis)
scripts/                 # seed data (synthetic only), tooling
.github/workflows/       # CI, security scans, deploy
docs/adr/                # architecture decision records
```

## Commands

```bash
pnpm install          # install JS/TS deps
pnpm dev              # run all dev servers (when apps exist)
pnpm test             # JS/TS tests (all workspace packages)
pnpm test:py          # Python tests (services/agents, services/matching)
pnpm lint             # eslint (root + packages)
pnpm typecheck        # tsc --noEmit across packages
pnpm db:migrate       # Prisma migrations (services/api)
pnpm db:seed          # synthetic seed data only
make security         # gitleaks + semgrep + trivy + dependency audits
make db-up / db-down  # local Postgres 16 + pgvector and Redis (Docker)
cd services/agents && uv run pytest / uv run promptfoo eval
```

On Windows without `make`, run the underlying commands directly (see `Makefile`) or use `pnpm security`.

## Prerequisites

- Node.js ≥ 20 with pnpm 10 (`npm i -g pnpm` or corepack)
- Python ≥ 3.12 with [uv](https://docs.astral.sh/uv/)
- Docker Desktop (local Postgres/Redis) — optional until cloud envs exist
- make, gitleaks, semgrep, trivy for the security suite (CI has them)

## Non-negotiables

See `AGENTS.md` — the short list: no secrets in git, RLS + service-layer authz on every user-data table, Zod/Pydantic validation everywhere, all LLM calls via the LLM Gateway (Claude API only), no raw user text crosses between users' agents, never log PII/OTPs/tokens.
