# P4 exit-criteria evidence

Generated: 2026-10-28T15:28:27.228Z (local run; CI re-runs all checks on every PR)
Mode: default (all checks must pass)

## Exit criteria (DESIGN.md §19, P4)

| Criterion | Status |
|-----------|--------|
| 1. Webhook replay test passes (idempotent) | PASS |
| 2. Paywall enforced server-side | PASS |
| 3. Contact-detail leakage in chat blocked | PASS |

## Checks

| Check | Result |
|-------|--------|
| pnpm test (API: all suites incl. P4 messaging/billing/notifications) | PASS |
| packages/logger redaction tests | PASS |
| i18n key parity (en/hi/ta) | PASS |
| python suites (agents incl. A8 coordinator + matching) | PASS |
| Playwright web e2e (onboarding in English and Hindi) | PASS |
| pnpm lint | PASS |
| pnpm typecheck | PASS |
| P4 criterion 1 — webhook replay test (idempotent) | PASS |
| P4 criterion 2 — paywall enforced server-side | PASS |
| P4 criterion 3 — contact-detail leakage in chat blocked | PASS |
| P4-09 — A8 coordinator tools authz (agent + user binding) | PASS |
| Planted secret blocked | PASS |
| gitleaks detect (clean repo) | PASS |
| LLM SDK isolation | PASS |

**Overall: PASS**

## Output tails
### pnpm test (API: all suites incl. P4 messaging/billing/notifications) (exit 0)

```
services/api test:  [32m✓[39m test/auth/config-guardrails.spec.ts [2m([22m[2m17 tests[22m[2m)[22m[32m 39[2mms[22m[39m
services/api test: [2m Test Files [22m [1m[32m36 passed[39m[22m[90m (36)[39m
services/api test: [2m      Tests [22m [1m[32m307 passed[39m[22m[90m (307)[39m
services/api test: [2m   Start at [22m 20:55:35
services/api test: [2m   Duration [22m 97.40s[2m (transform 2.01s, setup 0ms, collect 36.52s, tests 41.08s, environment 13ms, prepare 3.94s)[22m
services/api test: Done
```

### packages/logger redaction tests (exit 0)

```
 [32m✓[39m test/redact.spec.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 113[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m9 passed[39m[22m[90m (9)[39m
[2m   Start at [22m 20:57:14
[2m   Duration [22m 823ms[2m (transform 165ms, setup 0ms, collect 213ms, tests 113ms, environment 0ms, prepare 151ms)[22m
```

### i18n key parity (en/hi/ta) (exit 0)

```
> @saath/i18n@0.0.0 test D:\Agentic Matrimony\saath-kit\packages\i18n
> node test/validate-translations.mjs

OK: en.json (68 keys)
OK: hi.json (68 keys)
OK: ta.json (68 keys)
```

### python suites (agents incl. A8 coordinator + matching) (exit 0)

```
.venv\Lib\site-packages\fastapi\testclient.py:1
  D:\Agentic Matrimony\saath-kit\services\matching\.venv\Lib\site-packages\fastapi\testclient.py:1: StarletteDeprecationWarning: Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead.
    from starlette.testclient import TestClient as TestClient  # noqa

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
======================== 53 passed, 1 warning in 0.61s ========================
```

### Playwright web e2e (onboarding in English and Hindi) (exit 0)

```
  ok 1 e2e\onboarding.en.spec.ts:5:5 › sign up and complete onboarding in English (12.9s)
  ok 2 e2e\onboarding.hi.spec.ts:5:5 › sign up and complete onboarding in Hindi (4.7s)

  2 passed (31.0s)
[WebServer] ◇ injected env (1) from .env.local
[WebServer] ◇ injected env (0) from .env
```

### pnpm lint (exit 0)

```
apps/admin lint: Done
apps/web lint$ node scripts/check-i18n.mjs
services/api lint$ eslint .
apps/web lint: OK: no hard-coded JSX text in apps/web/src
apps/web lint: Done
services/api lint: Done
```

### pnpm typecheck (exit 0)

```
packages/logger typecheck: Done
apps/admin typecheck: Done
apps/web typecheck$ tsc --noEmit
services/api typecheck$ tsc --noEmit -p tsconfig.json
apps/web typecheck: Done
services/api typecheck: Done
```

### P4 criterion 1 — webhook replay test (idempotent) (exit 0)

```
idempotency gate + signature test + replay test present (executed in pnpm test) → PASS
```

### P4 criterion 2 — paywall enforced server-side (exit 0)

```
PAYWALL gates (message cap, calls, intro credits) behind the entitlement authority; spec present → PASS
```

### P4 criterion 3 — contact-detail leakage in chat blocked (exit 0)

```
scanner (PHONE/EMAIL/URL/HANDLE) + pre-send gate + opt-in unblock + spec present → PASS
```

### P4-09 — A8 coordinator tools authz (agent + user binding) (exit 0)

```
agent pin + acting-user binding + spec present (executed in pnpm test) → PASS
```

### Planted secret blocked (exit 0)

```
canary detected, commit blocked (exit nonzero)
```

### gitleaks detect (clean repo) (exit 0)

```
    ○ ░
    ░    gitleaks

[90m8:58PM[0m [32mINF[0m 45 commits scanned.
[90m8:58PM[0m [32mINF[0m scan completed in 383ms
[90m8:58PM[0m [32mINF[0m no leaks found
```

### LLM SDK isolation (exit 0)

```
> saath@0.0.0 check:llm-isolation D:\Agentic Matrimony\saath-kit
> node scripts/check-llm-isolation.mjs

OK: all LLM SDK usage is confined to the LLM Gateway module.
```
