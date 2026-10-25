# ADR-0011: Admin access model — RBAC claim + JIT elevation + append-only audit (SSO/MFA deferred)

**Status:** accepted · **Date:** 2026-10-25 · **Decided with:** owner (P2 plan Q4 default)

## Context

DESIGN.md §12.2 requires: RBAC roles, an admin console on a separate origin with SSO+MFA, IP allow-list/VPN, JIT elevation with expiry, and every record view logged (T7 insider misuse). Google Workspace / Okta accounts do not exist yet (ADR-0005), so real SSO cannot be integrated in P2.

## Decision

- `users.role` (member|support|moderator|admin|superadmin) is carried as a **JWT claim** (stale ≤ the 10-min access TTL; refresh re-reads from the DB).
- **JIT elevation**: `POST /v1/admin/jit/elevate` (staff roles only, reason required, `ADMIN_JIT_TTL_SEC` default 15 min, one active grant, explicit drop, expiry enforced in the guard). Solo mode allows self-grant — flagged and audited; the second-approver workflow arrives with SSO.
- **Every admin view and action writes an `admin_audit` row** (append-only: SELECT+INSERT grants, service-context, ids/kinds + bounded meta — never record contents). C4 is masked in admin responses (`*_enc` never decrypted; phone/email show `••••••`).
- `apps/admin` is an internal, staff-facing, **English-only** console (rule 14 covers user-facing UI).
- Deferred to P5 hardening: SSO+MFA, IP allow-list/VPN, second-approver JIT, audited C4 unmask action, separate deploy/domain.

## Consequences

- P2 meets "every admin view audited" with executable proof while staying honest about the SSO deferral.
- When SSO lands, the guard switches from JWT-role to identity-provider claims; the audit trail and elevation tables are unchanged.
