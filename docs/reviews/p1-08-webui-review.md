# P1-08 review — web onboarding UI (security + privacy)

Scope: `apps/web` scaffold (login / onboarding chat / review-confirm), `packages/i18n` ta.json + web strings, `services/api/scripts/e2e-serve.ts`, root tooling (pnpm override, eslint ignore). No new API endpoints, tables, fields or LLM flows.

## Security (OWASP ASVS L2 lens) — PASS

| Sev | Finding | Disposition |
|-----|---------|-------------|
| Low | `GET /__e2e/otp` returns the latest mock OTP | Test-only hook on the e2e server: 127.0.0.1-bound, mock provider codes only, script is dev tooling refused in prod by the existing config guardrails (`OTP_PROVIDER=mock` throws in production) |
| Low | `sessionId` taken from the review page query string | Used only as a path param to an existing AuthGuarded endpoint; `ParseUUIDPipe` rejects anything else; owner-only 404s are enforced server-side (P1-06 tests) |
| —   | Middleware `saath_at` check is UX-only | By design; every API route keeps its own AuthGuard/CsrfGuard (tests exist) |
| —   | CSRF double-submit header on all mutating calls; `saath_at`/`saath_rt` remain httpOnly (asserted in both Playwright specs); AI output rendered as plain text, no `dangerouslySetInnerHTML` | No issue |
| —   | No secrets in diff (manual sweep; gitleaks/semgrep/trivy not installed on this machine — environmental, pre-existing; pip-audit clean) | Only ephemeral embedded-PG dev passwords, same as test/global-setup.ts |

## Privacy (DPDP lens) — PASS

- No new personal-data fields, no new processing purposes. Phone + chat answers flow through the existing OTP and A1 pipelines with their controls.
- No analytics/tracking added; language switcher is a plain navigation link.
- Review page renders the user's own transcript back to them via the owner-only transcript endpoint.
- No new LLM flows from the browser; all model calls remain server-side via the gateway.
