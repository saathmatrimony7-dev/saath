# P3-01 Review — Embeddings foundation (pgvector + provider + save_embedding tool)

**Date:** 2026-10-25 · **Scope:** `20261025201000_p3_embeddings` migration, `profiles.embedding`, `save_embedding` internal tool, `services/matching` embeddings module, pgvector-in-harness installer · **Verdict: PASS** (no open High/Critical; 3 accepted Lows)

## Security review (role: security-reviewer, DESIGN.md §12, ASVS L2)

| Severity | Location | Finding | Disposition |
|----------|----------|---------|-------------|
| — | tools.controller.ts `save_embedding` | Endpoint behind `AgentTokenGuard` + `@ToolName` allow-list + `assertBinding`; anon 401, wrong binding 403, allow-list miss 403 — all tested | PASS |
| — | profiles.service.ts `saveEmbedding` | Hand-written SQL only for the pgvector literal; every element validated `Number.isFinite` and `\|x\| ≤ 1e6` before joining (no quote/semi-colon reachable); `user_id` is parameterised with `$1::uuid`; write runs under the owner's `withUser` RLS context | PASS |
| Low | profiles.service.ts:82 | Vector literal is string-built SQL (not parameterised — pgvector has no Prisma binding). Safe only because of the numeric validation directly above; a future edit that skips validation would be injectable. Mitigation: comment in code; consider SQL-function parameterisation in P3-04 if more vector SQL is added | Accepted (documented) |
| — | migration `20261025201000_p3_embeddings` | `CREATE EXTENSION IF NOT EXISTS vector` runs as the migration superuser (ADR-0002); cloud images pre-provision the extension; the embedded harness gets a **locally compiled** DLL (pinned pgvector v0.8.0, first-party toolchain — VS Build Tools + official PG source + Microsoft SDK NuGet packages; no third-party binary) | PASS |
| — | services/matching embeddings module | No network, no secrets; hashing provider deterministic and local; factory refuses `hashing` when `node_env=production` (guardrail + test, mirrors config.ts rails) | PASS |
| — | Test harness (global-setup, e2e-serve) | Installer is idempotent, path-resolved via the installed package (no env influence), fails loudly with build instructions if artifacts missing | PASS |
| Info | PG server logs (dev/test) | Full vector literal appears in local Postgres error logs on failed statements. C2 data, dev-only, not shipped to prod telemetry | Accepted |

No prompt/agent change in P3-01 → red-team pass not triggered (lands with A5/A6 in P3-05).

## Privacy review (role: privacy-reviewer, DESIGN.md §2.2/§10)

| Severity | Location | Finding | Disposition |
|----------|----------|---------|-------------|
| — | `profiles.embedding` | Classified **C2** per §10.1 (embeddings listed explicitly); inherits `profiles` FORCE RLS + owner/service policies; no new policy needed; deleted with the profile (cascade) | PASS |
| — | Purpose limitation | Use = matchmaking over normalised summaries; covered by the §10.2(a) matchmaking consent; the consent check at feed surfaces is scheduled (P3-08) and tracked in the P3 plan | PASS (tracked) |
| — | Data residency / LLM flow | No LLM call in this task; embedding providers are local-only (bge-m3 on-prem; hashing). No cross-user data flow introduced | PASS |
| — | Minimisation | Column stores derived vectors of the A2-normalised summary, never raw bio (enforced at summary-schema level in P3-02, contract-tested) | PASS |
| Low | Export/erasure flows | DPDP export (P5) should exclude or include embeddings deliberately; erasure is automatic via profile cascade | Accepted (P5 scope) |

**Reviewer conclusion:** PASS — proceed to P3-02.
