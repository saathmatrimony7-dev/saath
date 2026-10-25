# P1 security review (full phase diff)

**Scope:** P1-01…P1-10 — `9b607c6..HEAD` (139 files, +11,234). Method: OWASP ASVS L2 +
OWASP Top 10 for LLM Apps, read of the full diff, plus the executable proofs
(authz matrix 14 rows, RLS suite, guardrails spec, red-team suite, per-task
reviews `p1-08-webui-review.md` / `p1-09-whatsapp-review.md`).

## Findings

| Sev | Area | Finding | Status |
|-----|------|---------|--------|
| Low | WhatsApp webhook | Zod 400 precedes signature 401 (payload-shape probing without the secret — shape is Meta-public) | Accepted; defer pre-parse check to real Meta integration (P2) |
| Low | WhatsApp webhook | No rate limit / IP allow-list yet | Accepted per DESIGN.md "where possible"; wamid dedupe bounds retries; P2 with real Meta |
| Low | Web middleware | `saath_at` cookie check is UX-only | By design — every API route keeps AuthGuard/CsrfGuard (matrix rows prove 401/403) |
| Low | CI tooling | semgrep/trivy not installed on the dev box (gitleaks + pip-audit + terraform fmt run locally) | Environmental; wire into CI (pinned SHAs) in P2 devops task |

No High/Critical findings remain open.

## Verified controls (with proof)

- **Access control:** authz matrix covers every P1 endpoint × (anonymous, owner)
  — incl. foreign profile 404 (never 403), no-CSRF 403s, public taxonomy reads,
  webhook signature-as-auth 401s. RLS suite proves cross-user reads/writes fail
  at the database for all P1 user-data tables, consents append-only (no
  UPDATE/DELETE grants), onboarding_messages not injectable into foreign sessions.
- **Injection:** strict Zod DTOs everywhere (unknown fields rejected); no
  string-built SQL outside migrations; AI output rendered as plain text in the
  web app (no `dangerouslySetInnerHTML`, no `eval` — grep-verified); A2 output
  passes a strict Pydantic boundary (extra=forbid, ≤200-char values, sanitised
  dealbreaker names) — red-team suite proves model-emitted extra keys/oversized
  values/malicious field names cannot cross it.
- **Auth/session:** httpOnly `saath_at`/`saath_rt`, rotating refresh with reuse
  detection, CSRF double-submit on all cookie mutations, OTP rate limits +
  expiry purge; Playwright e2e asserts tokens are invisible to JS.
- **LLM:** Anthropic SDK confined to the LLM Gateway (`check:llm-isolation`);
  scoped agent tokens (HMAC, per-tool allow-list, user binding, 15-min cap);
  tool endpoints reject wrong-agent/wrong-user tokens (tests); token budgets +
  `llm_calls` audit; prompts contain no secrets or internal paths (tested +
  grep-verified); user content treated as data (delimited transcript blocks).
- **Secrets:** gitleaks clean-repo scan PASS; planted-canary commit blocked;
  no secrets in prompts/seeds/code (manual sweep); prod guardrails refuse mock
  providers, insecure cookies, default webhook secret (8 guardrail tests).
- **Webhooks:** signature verification (HMAC over raw body, constant-time),
  idempotent event ids, per-message failure isolation (P1-09 review).

**Verdict: PASS** (no open High/Critical; Lows accepted with documented deferrals)
