# P3-03 Review — Matching module (eligibility + hard filters)

**Date:** 2026-10-25 · **Scope:** `matching` module (service/controller/module/tokens), `20261025221000_matching_user_lookup`, internal `check-hard-filters` + `stale-embeddings` endpoints, config, tests · **Verdict: PASS** (no High/Critical; 2 accepted Lows)

## Security review

| Severity | Location | Finding | Disposition |
|----------|----------|---------|-------------|
| — | matching.service.ts `eligiblePool` | Tagged-template parameterised SQL (user id, limit); static query; pool capped by config (`MATCHING_POOL_LIMIT`); transaction-local `'matching'` GUC | PASS |
| — | `hardFilterCheck` / `assertEligiblePair` | Reason codes from a closed constant vocabulary; `DEALBREAKER_<FIELD>` only from the allow-listed field map (uppercased constant keys, no user strings); foreign ids 404 (indistinguishable from missing) | PASS |
| — | `POST /v1/internal/matching/*` | `ServiceTokenGuard` on both; zod strict bodies; 401 tested; no user-scoped surface exposed | PASS |
| — | Dealbreaker evaluation | Requirement semantics (§7.2); null partner value passes (cannot disprove); non-numeric `lt`/`gt` un-evaluable → pass; unknown field informational only (never fails) | PASS |
| — | Migration | Lookup policy extended `('identity','channels','safety','admin','matching')` — current list verified from the latest extension migration (admin was added after the safety one); other tables already use the generic service policy; drop/recreate mirrors siblings | PASS |
| Low | Cross-spec test flake | Isolated `test/rls` runs occasionally race on the shared embedded DB (unique-constraint blip under concurrency with other specs); full suite (the CI-style invocation) stable across repeated runs. Root cause: shared single DB by design; revisit with per-worker schemas if it recurs | Accepted (monitor) |
| Info | `evaluatePair` logs user ids | Pseudonymous ids via the redaction logger — same pattern as the rest of the codebase | Accepted |

## Privacy review

| Severity | Location | Finding | Disposition |
|----------|----------|---------|-------------|
| — | Purpose limitation | Cross-user profile/preference reads exist solely for the matchmaking pipeline under the `'matching'` service context; no new data collected; rule 10 honoured (community/religion only as user-declared filters, nothing inferred) | PASS |
| — | Reason codes | Never carry user identifiers or free text; incompatible pairs get codes only server-side (§7.4 rule 4 — no why-revelation to parties is a P3-05/08 UI concern) | PASS |
| — | Deletion/retention | No new tables; no PII stored | PASS |

**Reviewer conclusion:** PASS — proceed to P3-04.
