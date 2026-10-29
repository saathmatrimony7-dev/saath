# P3-07 Review — A4 matchmaker + nightly batch + 100k benchmark (exit criterion 3)

**Date:** 2026-10-26 · **Scope:** `20261026130000_daily_matches` migration (+ batch indexes), batched pre-rank (`loadSidesForBatch`, same `evaluatePair`), batch-users / shownCounts / publish service methods, A4 tools controller (`get_candidates`/`request_screening(s)`/`publish_daily_matches`), mock/http screening-broker transport (+ prod guardrail), A4 engine + threaded batch runner + `/internal/batch/run` trigger in services/agents, `benchmark-batch.ts` · **Verdict: security + privacy PASS, no High/Critical, 2 accepted Low — BUT exit criterion 3 is NOT yet verified** (no completed 100k run; two attempts failed/were truncated — see `docs/p3-batch-benchmark.md`; full run deferred pending the `shownCountsFor` O(n²) fix)

## Security review

| Severity | Location | Finding | Disposition |
|----------|----------|---------|-------------|
| — | A4 tools | Agent-token guard + `@ToolName` allow-list + A4-agent-name check + `acting_for_user_id` binding (a token for user A can never publish or fetch candidates for user B); strict zod bodies | PASS |
| — | Screening delegation | `request_screening(s)` is a plain forwarding tool — the broker protocol's security invariants (redacted snapshots, hash-bound writes, service-only RLS) are unchanged from P3-05; the http transport reuses the service-token pattern (timing-safe compare) | PASS |
| — | Publish | Replace-set in one transaction; rank uniqueness + config cap enforced; candidates FK-validated by the DB; no free-text columns exist in daily_matches (explanation_i18n is P3-09, jsonb) | PASS |
| — | Broker transport config | `SCREENING_BROKER_TRANSPORT` mock refused in production via the config guardrail (same pattern as OTP/KYC/moderation mocks) | PASS |
| — | Batch trigger | `/internal/batch/run` service-token guarded, strict body, returns aggregate stats only (no per-user data on the wire) | PASS |
| Low | Mock broker verdicts | Deterministic hash-based verdicts (70/20/10) are a stand-in, not a quality signal — the real eval evidence is P3-06's REAL=1 report; benchmark conclusions are about the deterministic path | Accepted (documented) |
| Low | Batch runner threading | Shared httpx client across worker threads (httpx sync client is thread-safe; connection-pooled); per-user isolation means one user's failure cannot corrupt another's publish | Accepted |

## Privacy review

| Severity | Location | Finding | Disposition |
|----------|----------|---------|-------------|
| — | daily_matches RLS | FORCE RLS; owner SELECT (own feed only — the candidate-side user cannot see the row), service-context writes only, unique (user, candidate, batch_date); owner insert/update denied (tested) | PASS |
| — | Data minimisation | Feed rows carry ids + rank + score + status only; no preference, screening or text data; verdicts remain behind the P3-05 service-only table | PASS |
| — | Benchmark corpus | 100k users fully synthetic (deterministic PRNG, hash phones, no real data); ephemeral embedded PG destroyed after the run; benchmark JSON contains aggregates only | PASS |

## Exit criterion 3 evidence — PARTIAL, full run deferred

Measured on this machine (embedded Postgres 16, single instance, Core API in-process, 8 runner threads, mock screening transport per the plan's documented-scaling-model sanction). Full details + artifacts: **`docs/p3-batch-benchmark.md`**.

| Scale | Seed | Batch | per-user | Extrapolated 100k |
|---|---|---|---|---|
| 2,000 users | 9.0s | 25.8s | 12.5ms | 21.5min |
| 100,000 users | — | **not completed** | | see below |

100k attempts: **#1** died under 1,156 Prisma P2028 interactive-tx timeouts in `retrieveCandidates` (fixed: 60 s tx timeout + post-seed `ANALYZE`). **#2** ran the batch phase 153 min with **zero P2028s and zero API errors** before the 3 h task timeout killed it mid-run — healthy but over the 2 h bar. Root cause of the remainder: `shownCountsFor` (§8 step 8) does a per-user `GROUP BY` over `daily_matches` with no `batch_date` index → O(n²) at 100k; fix designed (in-memory per-day counts [+ index]), implementation and the final run deferred by owner decision.

**Reviewer conclusion:** security/privacy reviews PASS, but **criterion 3 must be treated as PENDING** — do not gate P3-11/12 sign-off on it until the post-fix 100k run lands. P3-08 (daily feed + interactions API) can proceed in parallel with the optimization.
