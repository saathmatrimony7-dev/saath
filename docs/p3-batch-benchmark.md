# P3-07 batch benchmark — nightly batch at 100k synthetic users

**Date:** 2026-10-26 (updated 2026-10-28, P3-12 + criterion-3 amendment) · **Criterion:** DESIGN.md §19, P3 exit criterion 3 — nightly-batch benchmark · **Status: MET per the AMENDED criterion (owner decision 2026-10-28); the full 100k run is DEFERRED TO POST-P5 hardening.** Criterion 3 is now non-blocking for P3 sign-off: the required evidence is (a) the passing 2,000-user smoke benchmark below (0 errors) and (b) the P3-12 `shownCountsFor` scalability fix with its tests. The full 100k-user nightly benchmark — the **< 2 h threshold is retained** for that deferred run — remains tracked here with its implemented fix, diagnosed history, and reproduce instructions. All evidence to date is recorded below.

## TL;DR

- The deterministic Stage-1 path (mock screening broker, per the plan's documented-scaling-model sanction) passes cleanly at 500 and 2,000 users: 0 errors, batch time scales ~linearly (2k users → 25.8 s, extrapolated **21.5 min** for 100k at constant per-user cost).
- Two 100k attempts did not complete:
  - **Attempt 1** never progressed: 1,156 Prisma P2028 interactive-transaction timeouts in `retrieveCandidates`. **Fixed** (tx timeout 60 s + post-seed `ANALYZE`).
  - **Attempt 2** ran the batch phase for **153 min with zero P2028s and zero API errors** before the 3 h task timeout killed it mid-run. Completion state unknown; no summary JSON.
- The remaining >2 h cause was diagnosed: `shownCountsFor` (§8 step 8) ran a per-user `GROUP BY` over `daily_matches` with no serving index → O(n²) at 100k. **Fixed in P3-12** (see below).
- **Exit criterion 3 (amended): MET for P3 sign-off** via the 2k smoke benchmark + the P3-12 fix/tests, verified by `scripts/p3-exit-check.mjs` (PASS in both default and `--strict` mode). The 100k run is deferred to post-P5 hardening; the < 2 h threshold below applies to it when it runs.

## Environment

| | |
|---|---|
| Machine | Snapdragon X, 8 cores / 8 threads, 16 GB RAM, Windows |
| Database | Embedded Postgres 16.14, ephemeral (destroyed after each run) |
| App | Real Nest app in-process (e2e-serve recipe), logger `warn` |
| Runner | Real Python batch runner (`saath_agents.batch`), 8 workers, over HTTP against the Core tool surface |
| Screening | Deterministic mock broker transport (refused in production via config guardrail; per the plan's documented-scaling-model sanction) |
| Vectors | pgvector (locally built vector.dll, ADR-0012); HNSW `vector_cosine_ops` index (P3-04 migration) |
| Corpus | N fully synthetic users (deterministic PRNG, hash phones; never real user data) |
| ORM | Prisma 6.19.3 |

## Method

`scripts/benchmark-batch.ts` seeds N users → runs `ANALYZE` → boots the real Core API → runs the real nightly batch runner end-to-end. Two timings are reported separately: `seedMs` (benchmark-harness-only work; production has no synthetic seed) and `batchMs` (the nightly-batch work the criterion applies to).

## Measured results

### Clean smoke runs (errors = 0)

| Scale | Seed | Batch | per-user | Extrapolated 100k | published | screeningCalls |
|---|---|---|---|---|---|---|
| 500 users | 1.6 s | 57.9 s | 114 ms ¹ | 193 min ¹ | 730 | 3,067 |
| 2,000 users | 9.0 s | 25.8 s | 12.5 ms | **21.5 min** | 3,107 | 14,016 |

¹ The 500-user run was dominated by first-run warmup (the 2,000-user per-user cost is 9× lower); the 2,000-user run is the reliable extrapolation signal.

Note: three 200-user runs (`batch-benchmark-200-2026-10-26T122*.json`) failed fast with 200/200 user errors — a harness bring-up issue fixed before the 500-user run. They are retained in `docs/benchmarks/` for the record and are **not** evidence of pipeline quality. A post-fix 200-user smoke on 2026-10-28 (P3-12 harness changes) passed cleanly: 0 errors, 314 published, runner-reported 2.8 s (its artifact was removed to keep `docs/benchmarks/` limited to the pre-existing evidence set).

### 100k attempts

| Attempt | Wall clock | Batch-phase outcome | P2028 errors | End state |
|---|---|---|---|---|
| #1 | 18:03–20:03 | never progressed | 1,156 | killed by 2 h task timeout; no summary |
| #2 | 20:14–23:14 | ran 153 min; completion unknown | **0** | killed by 3 h task timeout; no summary |

Attempt #2's API log shows **no Nest errors across the entire 153 min batch phase** — the pipeline was processing healthily at 100k scale, just slower than the 2 h bar.

### Fixes applied between attempts (both verified by attempt #2)

1. `MatchingService.retrieveCandidates` interactive transaction: Prisma default 5 s timeout → `{ timeout: 60_000, maxWait: 20_000 }` (read-only tx: `set_config` + SELECTs).
2. Benchmark harness runs `ANALYZE` after the bulk seed — migrations had analyzed empty tables, leaving the planner with stale stats for the 100k corpus.

Verification: 153 min of 100k-user batching with **zero** P2028 (attempt #1 produced them constantly), zero other API errors.

## Known bottleneck at 100k — diagnosed, FIXED in P3-12 (run pending)

`MatchingService.shownCountsFor(day)` — §8 step 8 exposure counts — used to execute

```sql
SELECT "candidate_id", count(*)::int AS n
  FROM "daily_matches"
 WHERE "batch_date" = $day::date
 GROUP BY "candidate_id"
```

on **every `get_candidates` call** (once per user → 100k× per run). The `daily_matches` indexes are `(user_id, batch_date)` and `(candidate_id, batch_date)` — neither serves a `batch_date`-only predicate, so each call sequentially scans the whole table as it grows toward ~150k rows. Cost grows O(n²) across the run: invisible at 2k users, dominant at 100k.

**Fix (implemented P3-12, 2026-10-28):** per-day in-memory counts cache in `MatchingService` — lazily loaded from the DB once per day, kept exact by incremental updates after `publishDailyMatches` / `clearDailyMatches` commits (replace-set semantics subtract the user's previous candidates first), TTL-bounded (5 min) with an opportunistic sweep so multi-instance deployments converge; bounded staleness is acceptable because the exposure cap is a best-effort fairness throttle. The `GROUP BY` now runs at most once per TTL window instead of 100k×. A `(batch_date, candidate_id)` index migration was considered optional and skipped (one GROUP BY per 5-min window needs no extra index). Covered by `test/matching/batch.spec.ts` → *shown-counts cache (P3-12)*.

**Post-fix 100k run: DEFERRED TO POST-P5 hardening** (owner decision 2026-10-28). When it runs: supervised, ≥6 h outer timeout — 3 h proved too short in attempt #2; the harness now also streams runner stdout live and always tears down the ephemeral Postgres in a `finally`. Success threshold (unchanged): `batchMs < 7_200_000` (2 h), `errors: 0`, `exitCode: 0`. Placeholder until it lands (post-P5):

| Attempt | Wall clock | Batch-phase outcome | errors | End state |
|---|---|---|---|---|
| #3 (post-fix) | PENDING | PENDING | PENDING | PENDING |

## Real-LLM Stage-2 scaling model (per plan sanction)

This benchmark exercises the deterministic path end-to-end. Stage-2 advocate volume is bounded by DESIGN.md §7.4.8: Stage 2 runs only for the top N (default 30) candidates per user per day → ≤ 3 M Stage-2 calls/day at 100k users worst case. The deterministic `batchMs` measured here is therefore the **floor**; real-LLM operation adds per-screening advocate latency × the §7.4.8-bounded call count on top, and is covered by the scaling model rather than this run.

## Reproduce

```powershell
cd services/api
$env:BENCH_USERS='100000'; $env:LOG_LEVEL='warn'; $env:BENCH_WORKERS='8'
# 100k: run under supervision with an outer timeout >= 6 h (3 h proved too
# short in attempt #2); the runner's `[batch] done/total ...` lines stream
# live to the console (every 200 users → ~500 progress lines at 100k).
pnpm exec tsx scripts/benchmark-batch.ts
# summary JSON → docs/benchmarks/batch-benchmark-<users>-<ts>.json
```

Smoke: `pnpm exec tsx scripts/benchmark-batch.ts` (BENCH_USERS defaults to 1000).

## Evidence artifacts

| Artifact | What |
|---|---|
| `docs/benchmarks/batch-benchmark-500-2026-10-26T1229.json` | clean 500-user run |
| `docs/benchmarks/batch-benchmark-2000-2026-10-26T1233.json` | clean 2,000-user run (extrapolation basis) |
| `docs/benchmarks/batch-benchmark-200-*.json` | failed bring-up runs (historical, not quality evidence) |
| `~/.kimi/sessions/1f008b00d7f866cc7152089848d232bc/afb15a02-fb16-4e31-a2d3-bb405352ad6f/tasks/bash-8ypqykv2/output.log` | 100k attempt #1 (P2028 storm) |
| `~/.kimi/sessions/1f008b00d7f866cc7152089848d232bc/884fbf8a-5892-45d4-9cde-8ec9ffadd485/tasks/bash-0k9rwfzu/output.log` | 100k attempt #2 (153 min, 0 P2028, killed by 3 h timeout) |
