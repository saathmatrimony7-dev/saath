# P2 security review (full phase diff)

**Scope:** P2-01…P2-07 — `6bccd7f^..HEAD` region (P2 commits) + per-task reviews
(`p2-01-kyc`, `p2-03-safety`, `p2-05-moderation`, `p2-06-admin`). Method: OWASP
ASVS L2 + LLM Top 10 + insider-threat lens (T7) + hard-signal rules (T10).

## Findings

| Sev | Area            | Finding                                                                      | Status                                                                                                          |
| --- | --------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Low | KYC / webhooks  | Zod 400 before signature 401 (payload-shape probing; shape is vendor-public) | Accepted, same posture as P1-09; pre-parse check with the real vendors (P4/P5)                                  |
| Low | KYC webhook     | No IP allow-list/rate limit yet                                              | Accepted per DESIGN "where possible"; vendor deltas; P5 hardening                                               |
| Low | Admin           | JWT role claim stale ≤ 10 min after a role change                            | By design (JWT semantics); refresh rotates; documented in admin README                                          |
| Low | Admin           | Solo mode: JIT self-grant (no second approver)                               | Locked decision (P2 Q4); SSO/MFA/approval workflow with Workspace accounts (P5); every grant reasoned + audited |
| Low | MockKycProvider | Deterministic providerRef (test-only; refused in prod)                       | Accepted                                                                                                        |

No High/Critical findings remain open. All in-review findings were fixed in-task
(JIT chicken-and-egg, RLS reverse-block visibility, e2e-serve env loading,
A9 signal-length bound).

## Verified controls (with proof)

- **Exit criterion 1 (unverified cannot message):** `assertCanContact` gate
  (active + tier ≥ 1 + ageVerified) with machine-readable reasons; contact-gate
  tests in `test/kyc/contact-gate.spec.ts`; the P4 message path must call it.
- **Exit criterion 2 (scam detection ≥ 90%):** real-Claude A9 report committed —
  recall 90.0% (exact-label; 95% scam-family detection), precision 100%; corpus
  includes an injection attempt; red-team suite pins the verdict schema boundary.
- **Exit criterion 3 (every admin view audited):** per-endpoint audit assertions;
  append-only `admin_audit` (no UPDATE/DELETE grants, RLS-proven); C4 masked.
- **Hard signals (T10):** underage KYC → immediate block, further KYC refused —
  tested; CSAM-hash plumbing deferred (no real hash DB in P2).
- **Webhook security:** raw-body HMAC + constant time + idempotent event ids for
  both KYC and WhatsApp; dev secrets refused in production (guardrail tests).
- **LLM:** A9 via gateway only (budgets/audit/redaction); verdict schema
  extra=forbid; input bounded; SDK isolation check green.
- **Secrets:** gitleaks clean + canary blocked; no secrets in code/prompts.
