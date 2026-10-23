# P0 Security Review — security-reviewer pass

**Scope:** full P0 diff (commits `3b8abd1`…HEAD): monorepo, CI, Terraform, Prisma+RLS, logger, crypto, OTP/session auth, LLM gateway, agents skeleton.
**Method:** checklist review against DESIGN.md §12 (threat model, identity, appsec, data protection, LLM security), OWASP ASVS L2, OWASP LLM Top 10. Tests re-run as evidence.

## Findings

| Severity | File                                                                    | Issue                                                                                                      | Disposition                                                                                                                                                                |
| -------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Medium   | `src/modules/identity/sms/sms-provider.ts`, `llm-gateway/transports.ts` | Mock providers selectable in production via env misconfiguration                                           | **FIXED** — `loadConfig` refuses to boot in production with `OTP_PROVIDER=mock` or `LLM_GATEWAY_TRANSPORT=mock` (tests: `config-guardrails.spec.ts`)                       |
| Medium   | `src/config.ts`                                                         | `z.coerce.boolean()` made `COOKIE_SECURE='false'` evaluate truthy — Secure cookies could silently turn off | **FIXED** — `z.stringbool()`; guardrail test proves `'false'` is refused in production                                                                                     |
| Low      | `src/main.ts`                                                           | No security headers on the JSON API                                                                        | **FIXED** — helmet middleware added                                                                                                                                        |
| Low      | `src/modules/identity/otp.service.ts`                                   | Expired OTP rows lingered in `otp_codes`                                                                   | **FIXED** — expired rows deleted on each new request                                                                                                                       |
| Low      | `src/modules/identity/rate-limit.ts`, `llm-gateway/budget.ts`           | In-memory stores are per-instance; multi-instance deploys need Redis                                       | **ACCEPTED for P0** — `RateLimitStore`/`BudgetStore` interfaces are stable; Redis-backed store lands with infra (tracked for P1/P2). Single-instance dev is correct today. |
| Low      | `src/modules/identity/token.service.ts`                                 | Single JWT key in config; `kid` rotation plumbing not built                                                | **ACCEPTED for P0** — `kid` header + issuer pinning in place; rotation runbook is a P5 hardening item.                                                                     |
| Info     | `src/modules/identity/guards.ts`                                        | `otp/verify` sets session cookies without a CSRF token (login CSRF)                                        | **ACCEPTED** — login endpoint issues the first CSRF cookie; all subsequent mutating routes require double-submit. Standard pattern.                                        |
| Info     | Terraform                                                               | `dev` RDS is single-AZ                                                                                     | **ACCEPTED** — cost control; staging mirrors prod Multi-AZ (ADR-0002).                                                                                                     |

## Verified controls (evidence in tests)

- **T4 (IDOR):** FORCE RLS + owner policies + `NULLIF`-hardened unset-context deny; 9 RLS tests prove cross-user read/write isolation as the non-superuser `app_login` role. Service-layer authz: JWT guard binds identity to token subject; authz matrix tests (anonymous/other-user/CSRF rows) pass.
- **T3 (ATO):** OTP 6-digit/5-min/3-attempts/5-per-hour per phone AND IP; HMAC-peppered OTP storage; refresh rotation with reuse → session-family revocation (e2e proven).
- **T5/T12 (LLM):** SDK confined to `llm-gateway` (CI isolation check); PII redacted pre-transport (test inspects transport input); per-user budgets + global circuit breaker; service-token guard with constant-time compare on `/internal/*`.
- **T6/T11:** C4 field encryption (AES-256-GCM + HKDF separation), secrets via env/Secrets Manager, gitleaks locally+CI (planted canary blocked), SHA-pinned actions, lockfiles committed.
- **Logging:** redaction logger everywhere; OTPs/phones/tokens never logged (redaction tests).

**Verdict: PASS** — no open Critical/High; Mediums fixed; Lows accepted with tracking notes.
