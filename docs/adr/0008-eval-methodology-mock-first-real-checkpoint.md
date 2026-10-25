# ADR-0008: LLM eval methodology — mock-first in CI, real-Claude checkpoint for the accuracy bar

**Status:** accepted · **Date:** 2026-10-24 · **Decided with:** owner (P1 plan Q1/Q2/Q3)

## Context

The A2 extractor's exit bar is "≥ 90% field accuracy on the golden set with real Claude" — but CI cannot hold an Anthropic key, and re-running the real eval on every commit would be slow and non-deterministic.

## Decision

- **Two-tier evals.** Mock transport (`MockLlm`) verifies plumbing deterministically on every run (CI). The **real checkpoint** runs with `REAL=1 uv run python -m evals.run_extraction_eval` against the Core gateway with the owner-provided key; the runner itself enforces the threshold (exit code) and writes a versioned report (JSON + MD) to `services/agents/evals/reports/`.
- **Golden set:** 20 synthetic personas (en/hi/ta, 18 communities, mixed marital/diet edge cases, one injection persona) with a documented generation method. Accuracy = per-field token-overlap/synonym scoring against expected values.
- Evidence is the **committed real-run report**; `scripts/p1-exit-check.mjs` verifies a passing report exists (currently 91.3% ≥ 90%, 2026-10-24). A changed prompt/personas set invalidates the evidence until a new real run is committed.
- The scripted mock onboarding engine uses the same split: deterministic interview e2e in CI; the real A1 state machine (Python) is exercised via API tests with the mock engine and by the agents' own pytest suite.

## Consequences

- CI stays hermetic; the accuracy claim is reproducible from committed artifacts.
- The injection persona and red-team suite (`evals/redteam/`) run on every CI pass; deeper real-model red-teaming is a nightly job once keys exist.
- Threshold and budgets are config, not hard-coded.
