# AGENTS.md — Saath (Agentic AI Matrimony Platform)

You are the coding agent building this project. Read this file, then `docs/DESIGN.md` in full, before writing any code.

## Ground rules

- `docs/DESIGN.md` is the source of truth (architecture, data model, AI agents, security, build phases).
- Build strictly in the phase order of DESIGN.md §19 (P0 → P1 → …). At the end of each phase, check every exit criterion and report pass/fail with evidence. Don't start the next phase until all pass and the developer says go.
- Work in **small steps**: plan → show the plan → implement → run tests → summarise what changed. Commit after each working step with a clear message.
- Record design decisions or deviations as ADRs in `docs/adr/NNNN-title.md`.
- If the design is unclear or contradicts itself, stop and ask. Don't guess on security, privacy or payments.

## Roles (follow these checklists)

The files in `.claude/agents/` describe specialist roles: architect, backend-engineer, frontend-engineer, ai-agent-engineer, matching-engineer, devops-engineer, qa-engineer, security-reviewer, privacy-reviewer, red-team-tester.

- Before each task, read the matching role file and follow its rules.
- After each feature, do a separate **review pass** as `security-reviewer` and `privacy-reviewer` (read their files, review the diff, list findings by severity). Fix all High/Critical findings before moving on.
- After any change to the app's AI agents or prompts, do a `red-team-tester` pass.
- If subagents are available in this tool, you may delegate a role to a subagent; otherwise do the passes yourself, one after another.

## Two different AI models — don't mix them

- **You (the coding agent)** run on Kimi. You are only a development tool.
- **The product's in-app AI** (onboarding agent, matchmaker, screening broker, moderation, etc.) uses the **Claude API only** (Anthropic SDK, through the LLM Gateway, model names from config: `LLM_MODEL_SMALL`, `LLM_MODEL_MID`, `LLM_MODEL_LARGE`). Never add any other LLM provider to the application code.

## Stack

- Web/admin: Next.js + TypeScript + Tailwind + next-intl
- Core API: NestJS modular monolith (`services/api/src/modules/*`), Prisma, Zod
- Agents & matching: Python 3.12, FastAPI (internal only), Anthropic SDK, Pydantic v2
- Data: Postgres 16 + pgvector (row-level security on every user-data table), Redis, S3, SQS/EventBridge
- Infra: AWS ap-south-1 (Mumbai), Terraform, ECS Fargate, GitHub Actions with OIDC
- Shared TS packages: `@saath/logger` (redaction logging — never use console/bare pino), `@saath/crypto` (field-level encryption + HMAC for C4 columns)

## Coding conventions (added in P0; see docs/adr/)

- **Explicit `@Inject(TOKEN)` on every NestJS constructor dependency** — esbuild/tsx don't emit decorator metadata (ADR-0004). String tokens live in the module's `tokens.ts`.
- The API connects to Postgres as the non-superuser `app_login` role; superusers bypass RLS and must only run migrations (ADR-0002).
- RLS policies are hand-written SQL appended to Prisma migrations; every user-data table gets ENABLE+FORCE RLS plus owner/service policies (ADR-0001).
- Redaction regexes must be length-bounded (a 10 MB input caused catastrophic backtracking; regression test in packages/logger).
- Embedded Postgres on Windows inits with the ANSI codepage (WIN1252 server encoding) — non-ASCII data (Hindi/Tamil) then fails with SQLSTATE 22P05. Fixed by `initdbFlags: ['--encoding=UTF8', '--locale=C']` in dev-db.ts and test/global-setup.ts; legacy data dirs are healed by `scripts/enable-app-login.ts` (pg_database encoding UPDATE).
- `@swc/core` is pinned to 1.15.x (pnpm override): 1.16's self-loading carrier rejects default Windows drive ACLs and `next dev` fails to boot (swc#12442).
- apps/web talks to the Core API same-origin via a next.config rewrite (`/api/core/*` → `{CORE_API_URL}/v1/*`) — do not add CORS to the API. Session tokens stay in httpOnly cookies; the browser only reads the CSRF double-submit cookie for the `x-csrf-token` header. SSE turns use `fetch` + stream reader (EventSource can't set headers).
- pgvector (P3, ADR-0012): `CREATE EXTENSION IF NOT EXISTS vector` lives in a hand-written migration; the embedded-Postgres harness needs a **locally compiled** vector.dll (one-time `.tools/pgvector-spike/build-all.cmd`, VS Build Tools; no Docker/SDK admin install needed — SDK headers come from Microsoft's NuGet packages). `scripts/install-pgvector-embedded.cjs` copies the artifacts and is invoked by `test/global-setup.ts` + `scripts/e2e-serve.ts`. The `profiles.embedding vector(1024)` column is Prisma `Unsupported` — always via hand-written SQL with validated numeric literals.

## Commands (create in P0 and keep working)

- `pnpm install` / `pnpm dev` / `pnpm test` / `pnpm lint` / `pnpm typecheck`
- `pnpm db:migrate` / `pnpm db:seed` (synthetic data only)
- `cd services/agents && uv run pytest`
- `make security` → semgrep + gitleaks + trivy + dependency audit
- `node scripts/p0-exit-check.mjs` → P0 exit-criteria evidence runner
- `node scripts/p1-exit-check.mjs` → P1 exit-criteria evidence runner
- `node scripts/p2-exit-check.mjs` → P2 exit-criteria evidence runner
- `node scripts/p3-exit-check.mjs` -> P3 exit-criteria evidence runner (criterion 3 amended 2026-10-28: 2k smoke benchmark + shown-counts fix evidence; the 100k batch benchmark is deferred to post-P5 hardening)
- `node scripts/p4-exit-check.mjs` -> P4 exit-criteria evidence runner (webhook replay idempotency, server-side paywall, chat contact masking)
- `node scripts/p5-exit-check.mjs` -> P5 exit-criteria evidence runner (no open high/critical findings; DR restore drill within RTO via scripts/dr-drill.mjs; legal notices review-ready in docs/legal/)
- `pnpm check:llm-isolation` → proves the Anthropic SDK is confined to the LLM Gateway
- `pnpm test:e2e` → Playwright web e2e (sign up + onboarding in en/hi; boots the Core API e2e server with embedded PG + mock OTP/engine)
- Local DB without Docker: `cd services/api && pnpm db:dev` (embedded Postgres 16); with Docker: `make db-up`

## Non-negotiable rules

1. Never commit secrets, API keys, real user data or `.env` files. Use `.env.example` only; real keys go in AWS Secrets Manager or a git-ignored `.env.local`.
2. Every user-data table has Postgres row-level security **and** service-layer authorisation. Every new endpoint gets tests: owner allowed, other user denied, anonymous denied, admin access audited.
3. Validate all input with Zod/Pydantic and reject unknown fields.
4. All LLM calls go through the LLM Gateway (redaction, budgets, logging). No direct SDK calls elsewhere.
5. The app's AI agents act only via allow-listed internal tools with a scoped token. No agent gets DB credentials.
6. **No raw user text ever passes between two users' agents.** Screening uses structured, schema-validated data only (DESIGN.md §7). Write a test that proves it.
7. Treat all user-written content as untrusted data in prompts. No secrets or internal policy in prompts.
8. Never log PII, OTPs, tokens or message bodies. Use the redaction logger.
9. Sensitive fields (`*_enc`) use field-level encryption. Never store KYC document images after verification.
10. Never infer religion, community or caste. They are user-declared filters only.
11. Payment and subscription state comes only from verified webhooks/server checks, never from the client.
12. Webhooks: verify signature, store `event_id` for idempotency, process in a transaction.
13. Model names, prices, limits and thresholds are config, not hard-coded.
14. All UI text goes through i18n files.
15. Pin GitHub Actions by commit SHA; commit lockfiles.

## Definition of done

Tests pass · lint, type-check and security scan clean · authorisation tests for new endpoints · security and privacy review passes done · docs/ADR updated.
