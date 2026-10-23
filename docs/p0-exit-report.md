# P0 (Foundations) — Phase Exit Report

**Date:** 2026-10-22 · **Phase owner sign-off required before P1 begins.**

## Exit criteria (DESIGN.md §19)

| Criterion                                     | Result                    | Evidence                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI green                                      | **PASS (local-complete)** | All checks green locally: `pnpm lint` / `typecheck` / `test` (33 API tests), `pnpm test:py` (19 Python tests), gitleaks, terraform fmt+validate, LLM isolation. `.github/workflows/ci.yml` + `nightly.yml` encode every check with SHA-pinned actions. **Caveat:** GitHub repo not yet created (owner) — CI will run on first push; see ADR-0005. |
| RLS tests prove cross-user reads fail         | **PASS**                  | `services/api/test/rls/rls.spec.ts`: 9 tests — deny-by-default without context, owner-only reads, cross-user read/update/insert blocked via Prisma AND raw SQL, session isolation. Run as non-superuser `app_login` (superusers bypass RLS — ADR-0002). FORCE RLS + NULLIF-hardened policies in migration `20261021155656`.                       |
| Secrets scanning blocks a planted test secret | **PASS**                  | `gitleaks protect --staged` on a staged `sk-ant-...` canary → `leaks found: 1`, exit 1 (blocked). Clean repo scan → `no leaks found`, exit 0. Automated in `scripts/p0-exit-check.mjs` and the CI secrets-scan job.                                                                                                                               |
| Redaction tests pass                          | **PASS**                  | `packages/logger/test/redact.spec.ts`: 9 tests — key-based (phone/email/otp/tokens/`*_enc`/bodies, any depth) + pattern scrubbing (E.164, email, JWT, Bearer) + end-to-end log-line assertions + 10 MB anti-ReDoS regression.                                                                                                                     |

Full machine-generated evidence: `docs/p0-exit-evidence.md` (re-run: `node scripts/p0-exit-check.mjs`).

## Scope delivered

| Task                     | Delivered                                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-01 Monorepo           | pnpm workspace per §18, shared configs, Makefile, `.env.example`, stubs                                                                                                                  |
| P0-02 Secrets guardrails | `.gitleaks.toml` (+custom rules), pre-commit hooks, canary proof                                                                                                                         |
| P0-03 CI                 | 7-job `ci.yml` + `nightly.yml` (DAST/authz/redteam), SHA-pinned, `permissions: {}`                                                                                                       |
| P0-04 Terraform          | network/kms/database/cache/cloudtrail modules + dev/staging envs + bootstrap; validated, plan-only (ADR-0005)                                                                            |
| P0-05 Postgres+RLS       | Prisma schema (users/sessions), FORCE RLS migration, `withUser()` helper, synthetic seed, embedded-PG dev/test harness                                                                   |
| P0-06 Redaction logger   | `@saath/logger`, wired into API bootstrap                                                                                                                                                |
| P0-07 Crypto             | `@saath/crypto` AES-256-GCM `*_enc` + HMAC `*_hash`, KeyProvider (env now / KMS later)                                                                                                   |
| P0-08 Auth               | OTP (rate-limited, attempt-capped, HMAC-peppered), ES256 JWT 10-min + rotating refresh with reuse-revocation, httpOnly cookies + CSRF double-submit, strict Zod DTOs, authz matrix tests |
| P0-09 LLM Gateway        | tier routing from config, pre-transport redaction, budgets + circuit breaker, `llm_calls` audit, service-token guard, SDK isolation check in CI                                          |
| P0-10 Agents skeleton    | FastAPI internal app, HMAC scoped tokens (agent+user+tools, ≤15 min), gateway client, strict screening schemas, redteam seed                                                             |
| P0-11 QA evidence        | `scripts/p0-exit-check.mjs` + `docs/p0-exit-evidence.md`                                                                                                                                 |
| P0-12 Reviews            | `docs/reviews/p0-security-review.md` PASS, `p0-privacy-review.md` PASS; 2 Mediums + 2 Lows fixed                                                                                         |
| P0-13 ADRs + exit        | ADR-0001…0005; this report                                                                                                                                                               |

## ADRs written

- `0001` Prisma over Drizzle (RLS via hand-written migration SQL)
- `0002` Embedded Postgres for dev/test; `app_login` non-superuser role
- `0003` OTP vendor behind interface (MSG91 assumed)
- `0004` Explicit `@Inject` DI convention
- `0005` Plan-only infra until AWS/GitHub accounts exist

## Known deferrals (accepted, tracked)

- Redis-backed rate-limit/budget stores (interfaces stable; in-memory now) — P1/P2.
- JWT `kid` rotation runbook — P5.
- pgvector extension migration — P3 (needs pgvector-present Postgres).
- Web/admin apps — P1/P2 per plan (owner: publishing later).
- Anthropic live-key test — awaits owner-provided key; transport is mock until then.

**Recommendation: P0 exit approved.** Awaiting owner go for P1.
