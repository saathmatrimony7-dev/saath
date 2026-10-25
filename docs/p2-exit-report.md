# P2 (Trust & Safety) — Phase Exit Report

**Date:** 2026-10-25 · **Phase owner sign-off required before P3 begins.**

## Exit criteria (DESIGN.md §19)

| Criterion                        | Result   | Evidence                                                                                                                                                                                                                                                                                         |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unverified users cannot message  | **PASS** | `KycService.assertCanContact` (active account + tier ≥ 1 + ageVerified, machine-readable reasons) is the enforced precondition for the P4 message path; `GET /v1/me/verification` exposes it; gate tests (`test/kyc/contact-gate.spec.ts`): fresh user denied, verified allowed, blocked denied. |
| Scam test scripts detected ≥ 90% | **PASS** | Real-Claude A9 report (`services/agents/evals/reports/moderation_eval_real_*.md`): **recall 90.0%** exact-label (95% on scam-family detection), **precision 100%** on safe negatives; 40-script corpus (en/hi/Hinglish + injection attempt); verified by `scripts/p2-exit-check.mjs`.            |
| Every admin view audited         | **PASS** | `admin_audit` append-only (RLS-proven, no UPDATE/DELETE grants); every admin handler records a view/action row with actor + subject; per-endpoint assertions in `test/admin/admin.spec.ts`; the audit browser itself is audited.                                                                 |

Full machine-generated evidence: `docs/p2-exit-evidence.md` (re-run: `node scripts/p2-exit-check.mjs` — **all 13 checks PASS**: API suite with P2 RLS/authz rows, redaction, i18n parity, python suites, Playwright en/hi e2e, lint, typecheck, A9 + A2 real-Claude reports, gitleaks canary + clean scan, terraform fmt, LLM isolation).

Reviews: `docs/reviews/p2-security-review.md` **PASS** and `p2-privacy-review.md` **PASS** — no open High/Critical (5 accepted Lows with documented deferrals; in-review findings fixed in-task). Red-team suite extended to A9 (34 cases total: verdict schema boundary, unknown labels, oversized echoes, zero-width/Unicode tricks, no-input-echo).

## Scope delivered

| Task                   | Delivered                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-01 KYC + tiers      | `KycProvider` + mock/IDfy; consent-gated start; signed idempotent webhook; monotonic tiers 0-3; underage hard block; results-only storage (no raw docs) |
| P2-02 Contact gate     | `assertCanContact` + `GET /v1/me/verification` — **exit criterion 1**                                                                                   |
| P2-03 Reports & blocks | Append-only reports (deduped), idempotent blocks, both-direction hiding, service-context pair checks                                                    |
| P2-04 A3 risk scoring  | Deterministic Core rules engine + signal audit trail; deduped human-review cases; never auto-bans (ADR-0010)                                            |
| P2-05 A9 moderation    | Classifier + strict verdict schema + corpus + eval runner; report-details wiring; **real-Claude recall 90% PASS** — **exit criterion 2**                |
| P2-06 Admin console    | RBAC JWT claim, JIT elevation, append-only audit, masked directory, case queue + decide; `apps/admin` console — **exit criterion 3** (ADR-0011)         |
| P2-07 QA evidence pack | Authz matrix + RLS extended to all P2 tables; `scripts/p2-exit-check.mjs`                                                                               |

## ADRs written

- `0010` A3 risk scoring lives in Core (deterministic rules engine now; LLM deep-checks can join later)
- `0011` Admin access model: RBAC claim + JIT + audit now; SSO/MFA/IP allow-list/second approver deferred to P5

(+ ADR-0001…0009 from P0/P1 still governing.)

## Known deferrals (accepted, tracked)

- **Meta WhatsApp account / S3+Rekognition / embeddings** — carried from P1 (ADRs 0006/0007/0009).
- **Admin SSO+MFA, IP allow-list, second-approver JIT, audited C4 unmask** — P5 hardening (ADR-0011).
- **Webhook IP allow-listing + pre-parse signature checks** — with the real vendors (P4/P5).
- **Chat pre-send A9 checks + contact-detail leakage blocking** — P4 messaging scope (the classifier and the gate it will use exist).
- **CSAM hash-match block** — plumbing decision recorded; no real hash DB in P2.
- **CI on GitHub** — workflows committed, repo not yet created (owner); all checks run locally with committed evidence. **No push without owner approval.**

**Recommendation: P2 exit approved.** Awaiting owner go for P3 (Matching & screening).
