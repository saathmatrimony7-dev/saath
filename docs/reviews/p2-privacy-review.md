# P2 privacy review (full phase diff)

**Scope:** P2-01…P2-07. Method: DPDP lens (data classes, minimisation, purpose
limitation) + per-task reviews.

## Findings

| Sev | Area                | Finding                                                                     | Status                                                                            |
| --- | ------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Low | KYC vendor (future) | Real provider will see identity data; consent purpose `kyc` gates the start | Consent gate enforced + tested; DPA tracked with the vendor decision (D1)         |
| Low | Admin console       | Staff can view safety context (reports count, cases, masked profile)        | Purpose-aligned with moderation mandate; every view audited; C4 masked by default |

No High/Critical findings remain open.

## Verified controls (with proof)

- **KYC minimisation (§10.4):** raw documents never stored — results, provider
  ref, score, provider age, masked ID only; exact DOB never kept (age →
  `birthYear` + `ageVerified`); underage data handling = immediate block.
- **A9 hygiene:** the verdict crossing services is labels + ≤5 keywords ≤40
  chars — never user text (schema + route tests assert no echo).
- **Reports/blocks:** append-only ledger; reporter-scoped reads; block lists are
  id-only; blocked pairs hidden both directions.
- **Admin (T7):** C4 (`*_enc`) never decrypted for admin v1 — masked constant;
  the audit log stores ids/kinds only; `users_admin_update` RLS policy scoped to
  the admin context alone.
- **Consent:** kyc purpose required before starting verification (403 tested);
  whatsapp/matchmaking/agent_screening flows unchanged from P1.
- **No new analytics/tracking**; admin console is staff-facing English-only.
