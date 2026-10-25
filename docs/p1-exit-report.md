# P1 (Profiles & Onboarding) — Phase Exit Report

**Date:** 2026-10-24 · **Phase owner sign-off required before P2 begins.**

## Exit criteria (DESIGN.md §19)

| Criterion | Result | Evidence |
| --------- | ------ | -------- |
| User completes onboarding in Hindi **and** English | **PASS** | Scripted API interviews in both languages (`services/api/test/onboarding/onboarding.spec.ts`, mock engine) + **Playwright web e2e**: signup → OTP → full interview → review → confirm in `/en` (18.0s) and `/hi` (13.4s) through the real Next.js app (`apps/web/e2e/`, run by `pnpm test:e2e`). WhatsApp channel completes a full Hindi interview via the signature-verified webhook (`test/channels/whatsapp.spec.ts`). |
| Extracted profile accuracy ≥ 90% on the golden set (real Claude) | **PASS** | `services/agents/evals/reports/extraction_eval_real_20261024T125914Z.md`: **91.3%** (209/229 checks, 20 personas) ≥ 90% threshold; runner enforces the threshold (exit code), report committed, verified by `scripts/p1-exit-check.mjs`. Methodology: ADR-0008. |
| Consents recorded | **PASS** | Signup auto-records matchmaking + agent_screening (append-only ledger, notice version stamped) — `test/consent/consent.spec.ts` + RLS proof that UPDATE/DELETE grants are absent; whatsapp consent is explicit and opt-out withdraws immediately (webhook test). |

Full machine-generated evidence: `docs/p1-exit-evidence.md` (re-run: `node scripts/p1-exit-check.mjs` — **all checks PASS**: API 115 tests, redaction, i18n parity en/hi/ta, python suites, Playwright en/hi, lint, typecheck, A2 report, gitleaks canary + clean scan, terraform fmt, LLM isolation).

Reviews: `docs/reviews/p1-security-review.md` **PASS**, `p1-privacy-review.md` **PASS** — no open High/Critical (per-task reviews for the web UI and WhatsApp channel included; red-team suite: 14 injection probes en/hi/Hinglish + 29 safety-property tests).

## Scope delivered

| Task | Delivered |
|------|-----------|
| P1-01 Taxonomy + attribute definitions | Seeded religions/communities/sub-communities/cities + attribute defs with en/hi/ta labels; public locale-aware read endpoints; "no community inference" guard test |
| P1-02 Consent ledger | Append-only `consents` (SELECT+INSERT only, withdrawal = new row); `GET/PUT /v1/me/consents`; auto-record at signup |
| P1-03 Profiles + preferences | 7 tables with FORCE RLS; profile CRUD + dynamic community-attribute validation vs `attribute_definitions`; versioned preferences/dealbreakers/disclosure-policy; owner-only `GET /v1/profiles/{id}` (foreign 404) |
| P1-04 Photos | Presigned PUT → sharp re-encode (EXIF strip proven) → moderation → signed GET; MIME/size/count caps; Storage/ModerationProvider interfaces + mocks (ADR-0007) |
| P1-05 LLM Gateway v2 | SSE streaming, Anthropic tool-use passthrough, `/internal/tools/*` behind scoped HMAC agent tokens (agent+user+allow-list binding, golden-vector interop) |
| P1-06 A1 Onboarding Interviewer | Session/message tables (FORCE RLS), start/resume + SSE turns + confirm (profile live **only** on explicit confirm); Python state machine, versioned en/hi/ta prompts, `[AI]` label enforced in code, 25-turn cap |
| P1-07 A2 Extractor + evals | Strict Pydantic schema (extra=forbid, confidence floor → confirm questions), golden set of 20 personas, eval runner (mock CI / real checkpoint), **91.3% real-Claude PASS** |
| P1-08 Web UI | Next.js 15 + Tailwind + next-intl (en/hi/ta, all strings from i18n — lint gate); OTP login, SSE chat, review/confirm; tokens httpOnly-only; Playwright e2e en/hi |
| P1-09 WhatsApp channel | `ChannelAdapter` + mock/Meta adapters (ADR-0006); signature-verified, idempotent webhook; consent-gated outbound; opt-out keyword; same A1 engine |
| P1-10 QA evidence pack | Authz matrix 14 rows incl. all P1 endpoints; RLS suite extended to every P1 user-data table; `scripts/p1-exit-check.mjs` + evidence doc |
| P1-11 Reviews | Security + privacy reviews PASS; red-team suite wired into CI path |
| P1-12 ADRs + exit | ADR-0006…0009; this report |

## ADRs written

- `0006` Channel adapter abstraction; WhatsApp mock-first, Meta config-only
- `0007` Storage + moderation behind interfaces; local-disk mocks, sharp re-encode boundary
- `0008` Eval methodology: mock-first in CI, committed real-Claude checkpoint for the 90% bar
- `0009` Profile embeddings deferred to P3 (matching pipeline)

(+ ADR-0001…0005 from P0 still governing: Prisma, embedded PG, vendor interfaces, explicit DI, plan-only infra.)

## Known deferrals (accepted, tracked)

- **Meta WhatsApp account** — real adapter, IP allow-list, proactive templates, 24-hour window: config-only swap later (P2). Mock adapter covers e2e today.
- **S3 + Rekognition** — interfaces + local mocks only until AWS accounts exist (ADR-0005/0007).
- **Profile embeddings / pgvector** — P3 per ADR-0009.
- **Anthropic key in CI** — real-eval checkpoint is owner-key + committed report (ADR-0008); nightly real red-team once keys exist.
- **CI on GitHub** — workflows committed (SHA-pinned) but the repo isn't pushed yet (owner); all checks run locally, evidence committed. **No git push performed without owner approval.**
- **semgrep/trivy in CI**, Redis-backed rate limits/budgets, retention/DSR export+erasure jobs, admin console, payments — P2/P3 scope per DESIGN.md.

**Recommendation: P1 exit approved.** Awaiting owner go for P2.
