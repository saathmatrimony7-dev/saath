# CLAUDE.md — Saath (Agentic AI Matrimony Platform)

## Start here

- Read `docs/DESIGN.md` fully before any work. It is the source of truth for architecture, data model, agents, security and phases.
- Build in the phase order in DESIGN.md §19. Confirm the current phase's exit criteria before starting the next.
- Record every design decision or deviation as an ADR in `docs/adr/NNNN-title.md`.

## How to work

- You are the tech lead/orchestrator. Plan the phase, then delegate to subagents in `.claude/agents/`.
- Per feature: `architect` → engineer subagent → `qa-engineer` → `security-reviewer` + `privacy-reviewer` → `red-team-tester` (agent/prompt changes) → merge.
- `security-reviewer` and `privacy-reviewer` are **mandatory** for changes touching auth, personal data, agents, payments, consents or infra. Do not merge with open High/Critical findings.
- Keep PRs small and focused on one module.

## Models: two separate worlds

- **You (the coding assistant)** run on Kimi K3 through Claude Code. Setup: `docs/dev-setup-kimi.md`.
- **The product's in-app AI** uses the **Claude API** only (Anthropic SDK, via the LLM Gateway). Never wire any other LLM provider into application code, and never send user data to the coding model.
- WebFetch is unavailable on the Kimi endpoint. If you need external docs, ask the developer to add them under `docs/reference/`.
- Requests are rate-limited per 5-hour window. Use subagents deliberately (one per task) and avoid unnecessary parallel fan-out.

## Stack

- Web/admin: Next.js + TypeScript + Tailwind + next-intl
- Core API: NestJS modular monolith (`services/api/src/modules/*`), Prisma, Zod
- Agents & matching: Python 3.12, FastAPI (internal only), Anthropic SDK (Claude models from config: `LLM_MODEL_SMALL/MID/LARGE`), Pydantic v2
- Data: Postgres 16 + pgvector (RLS on every user-data table), Redis, S3, SQS/EventBridge
- Infra: AWS ap-south-1 (Mumbai), Terraform, ECS Fargate, GitHub Actions with OIDC

## Commands (create these in P0 and keep them working)

- `pnpm install` / `pnpm dev` / `pnpm test` / `pnpm lint` / `pnpm typecheck`
- `pnpm db:migrate` / `pnpm db:seed` (synthetic data only)
- `cd services/agents && uv run pytest` / `uv run promptfoo eval`
- `make security` → semgrep + gitleaks + trivy + dependency audit

## Non-negotiable rules

1. **Never** commit secrets, API keys (Kimi or Claude), real user data, or `.env` files. Use AWS Secrets Manager; `.env.example` only. Never write a key into `.claude/settings.json` in the repo.
2. **Every** user-data table has Postgres RLS **and** service-layer authorisation. Add an authorisation test for every new endpoint (owner can, other user cannot, admin path is audited).
3. Validate all input with Zod/Pydantic; reject unknown fields.
4. All LLM calls go through the LLM Gateway (redaction, budgets, logging). No direct SDK calls elsewhere.
5. Agents act only via allow-listed internal tools with a scoped token. No agent gets DB credentials.
6. **No raw user text crosses between users' agents.** The screening protocol uses structured, schema-validated data only (DESIGN.md §7).
7. Treat all user-generated content as untrusted data in prompts. Never put secrets or internal policy in prompts.
8. Never log PII, OTPs, tokens or message bodies. Use the redaction logger.
9. C4 fields (`*_enc`) use the crypto module for field-level encryption. Never store KYC document images after verification.
10. Never infer religion, community or caste. These are user-declared filters only.
11. Entitlements and payment state come only from verified webhooks or server-side checks, never from the client.
12. Webhooks: verify signature, store `event_id` for idempotency, process transactionally.
13. Model names, prices, limits and thresholds are config, not hard-coded.
14. All UI strings are in i18n files. No hard-coded user-facing text.
15. Pin GitHub Actions by commit SHA and keep lockfiles committed.

## Definition of done

- Tests written and passing (unit + integration; E2E for user journeys)
- Lint, type-check and the security scan are clean
- Authorisation tests present for new endpoints
- Evals pass for agent changes (no regression on golden sets)
- Security and privacy reviews passed where required
- Docs/ADR updated
