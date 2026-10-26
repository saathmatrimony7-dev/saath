# P3-06 Review — Screening eval: labelled pair corpus + false-incompatible ≤ 10% (exit criterion 2)

**Date:** 2026-10-26 · **Scope:** `evals/screening/corpus.py` (66 labelled pairs), `evals/run_screening_eval.py`, `evals/screening/test_corpus.py`, committed real-run report, A5 prompt + Stage-3 combine revision (v2) · **Verdict: PASS** (exit criterion 2 verified by real-Claude run; no High/Critical; 2 accepted Low)

## What was built

- **Corpus (ADR-0008 documented generation, synthetic only):** 60 Stage-2 pairs (en 30 / hi 18 / Hinglish 12 per plan Q3; 16 adversarial near-misses) + 6 Stage-1 short-circuit items. Each pair carries profile enums, preference enums and 1-2 authored soft-preference stances with a human ground-truth verdict. Exit-criterion-2 denominator = the 44 pairs labelled compatible/partial.
- **Runner:** two-tier per ADR-0008 — mock mode verifies plumbing deterministically in CI (pytest-collected); `REAL=1` drives the real A6 broker against the local Core gateway (anthropic transport) with the corpus-backed Core port (Stage-1 outcomes are authored/deterministic; the LLM surface is Stage 2/3, exactly where false-incompatible risk lives). The runner enforces the threshold via exit code and writes versioned JSON+MD reports.
- **Real checkpoint:** committed report `evals/reports/screening_eval_real_20261026T*.json/.md`.

## Result

| Metric | v1 first run | v2 final | Bar |
|---|---|---|---|
| False-incompatible rate | 22.7% (10/44) FAIL | **0.0% (0/44)** | ≤ 10% → **PASS** |
| Agreement | 75.8% | 74.2% | informational |
| Errors / stage-1 wrong | 0 / 0 | 0 / 0 | 0 required |
| Per-language FI (en/hi/hinglish) | — | 0 / 0 / 0 | — |

**First real run FAILED at 22.7%** — the value of the REAL=1 checkpoint. Root cause: single-topic pairs where one advocate said "conflict" on a negotiable tension combined to score 0.0 → INCOMPATIBLE, hiding the match. Fix (prompt + deterministic rule, versioned):
1. A5 prompt (a5-advocate-v2): sharpened partial/conflict boundary — "choose partial when torn; reserve conflict for directly opposed AND non-negotiable stances"; explicit "hiding a good match is the worst outcome" (§17 cost model).
2. Stage-3 combine (a6-screen-v2 / screening-rules-v2): a topic is `conflict` only when **both** advocates declare conflict (asymmetric visibility rule per §17); single-side conflict → partial. Compatible still requires both.
Residual errors are conservative (7 compatible→partial, 10 incompatible→partial): matches still surface, 0 good pairs hidden.

## Security review

| Severity | Location | Finding | Disposition |
|----------|----------|---------|-------------|
| — | Corpus | Synthetic personas only; deterministic uuid5 ids; no real user data (ADR-0008); stances validated ≤200 chars by integrity tests | PASS |
| — | Runner | Verdict path reuses the P3-05 strict schemas; no new endpoints, no secrets (key stays in services/api/.env.local); mock mode hermetic | PASS |
| — | Version bump | a6-screen-v2 pinned in Core config; Core refuses v1 writes (no rule drift between cached rows and current engine); hash-parity vector updated | PASS |
| Low | Prompt change | A5 prompt edited → red-team suite re-run required; full agents pytest (incl. redteam) 117/117 green after the change | Accepted (re-passed) |
| Low | False-compatible direction | 10/22 incompatible pairs rated partial (shown but flagged soft) — opposite of the exit metric; §17 prioritises not hiding good matches; tune thresholds/prompt in a later iteration with a false-compatible floor added to the corpus | Accepted (note for P3-12) |

## Privacy review

| Severity | Location | Finding | Disposition |
|----------|----------|---------|-------------|
| — | Eval data flow | Snapshots are the P3-05 redacted contract; no raw text in the corpus items that isn't a bounded normalised stance; the leak tests from P3-05 still cover the wire shape | PASS |
| — | Reports | Committed reports contain synthetic ids, stances and verdicts only — no PII, no keys (gitleaks-clean) | PASS |

**Verification evidence:** mock report + integrity tests 7/7 (shape, language split 30/18/12, ≥15 adversarial, bounded stances, schema-valid snapshots, mock pipeline); real report PASS at 0.0% FI over 44 positives, 120 real gateway calls (claude-haiku-5-5, tier small), 0 errors, stage-1 short-circuits 6/6; agents pytest 117/117 incl. red-team re-pass; Core suite + lint + typecheck green.

**Reviewer conclusion:** PASS — exit criterion 2 (false-incompatible ≤ 10%) verified by committed real-Claude evidence. Proceed to P3-07 (A4 matchmaker + nightly batch + 100k benchmark).
