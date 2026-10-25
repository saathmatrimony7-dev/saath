# ADR-0010: A3 risk scoring lives in Core as a deterministic rules engine (P2)

**Status:** accepted · **Date:** 2026-10-25 · **Decided with:** architect (P2-04 deviation from the task plan's Python-agent framing)

## Context

DESIGN.md places A3 (Trust & Verification) among the agents, and the P2 task plan sketched a Python A3 with Core tools. But P2's scoring signals — KYC outcomes, open report counts, photo pHash reuse — are all Core tables, and P2's requirement is a deterministic, auditable score with a threshold → human review queue. No LLM reasoning is needed for any P2 signal.

## Decision

- P2 A3 is a **Core rules engine** (`RiskScoringService`): weights in code with the threshold from config (`RISK_CASE_THRESHOLD`, default 60), every score carries its full signal audit trail, recomputed on KYC/report/photo events.
- Cases open into `safety_cases` (human review queue); **cases never auto-ban** — hard signals (underage) block via the KYC path.
- An LLM-assisted deep-check pass can join later as a consumer/producer of the same score+case surface without changing the API.

## Consequences

- Deterministic, cheap, testable without a key; the real-Claude checkpoint budget is spent where LLMs add value (A2 extraction, A9 moderation).
- If A3 later needs cross-reasoning signals (e.g., free-text analysis), wire it through the same gateway + scoped tools as A1/A2 rather than direct DB access.
