# P3 exit-criteria evidence

Generated: 2026-10-28T15:37:01.919Z (local run; CI re-runs all checks on every PR)
Mode: default (criterion 3 amended 2026-10-28: 2k smoke + fix evidence; 100k run deferred to post-P5)

## Exit criteria (DESIGN.md §19, P3)

| Criterion | Status |
|-----------|--------|
| 1. Screening never transmits raw text (test) + real-Claude report | PASS |
| 2. False-incompatible ≤ 10% (real-Claude screening report) | PASS |
| 3. Nightly-batch benchmark evidence (2k smoke + P3-12 scalability fix; 100k run deferred to post-P5) | PASS |

## Checks

| Check | Result |
|-------|--------|
| pnpm test (API: all P3 RLS/authz suites + full matrix) | PASS |
| packages/logger redaction tests | PASS |
| i18n key parity (en/hi/ta) | PASS |
| python suites (agents + matching) | PASS |
| Playwright web e2e (onboarding in English and Hindi) | PASS |
| pnpm lint | PASS |
| pnpm typecheck | PASS |
| P3 criterion 1+2 — A6 screening eval (real-Claude report, FI ≤ 10%) | PASS |
| P3-09 — A4 explanation eval (real-Claude spot run) | PASS |
| P3-11 — bias-check eval (deterministic, protected-attribute parity) | PASS |
| A9 moderation eval (real-Claude report, still binding from P2) | PASS |
| A2 golden-set eval (real-Claude report, still binding from P1) | PASS |
| P3 criterion 3 — 2k smoke benchmark (0 errors) + shown-counts fix | PASS |
| Planted secret blocked | PASS |
| gitleaks detect (clean repo) | PASS |
| LLM SDK isolation | PASS |

**Overall: PASS**

## Output tails
### pnpm test (API: all P3 RLS/authz suites + full matrix) (exit 0)

```
services/api test:  [32m✓[39m test/auth/config-guardrails.spec.ts [2m([22m[2m17 tests[22m[2m)[22m[32m 37[2mms[22m[39m
services/api test: [2m Test Files [22m [1m[32m36 passed[39m[22m[90m (36)[39m
services/api test: [2m      Tests [22m [1m[32m307 passed[39m[22m[90m (307)[39m
services/api test: [2m   Start at [22m 21:04:12
services/api test: [2m   Duration [22m 97.03s[2m (transform 2.08s, setup 0ms, collect 36.78s, tests 40.65s, environment 14ms, prepare 4.00s)[22m
services/api test: Done
```

### packages/logger redaction tests (exit 0)

```
 [32m✓[39m test/redact.spec.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 112[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m9 passed[39m[22m[90m (9)[39m
[2m   Start at [22m 21:05:51
[2m   Duration [22m 802ms[2m (transform 147ms, setup 0ms, collect 188ms, tests 112ms, environment 0ms, prepare 149ms)[22m
```

### i18n key parity (en/hi/ta) (exit 0)

```
> @saath/i18n@0.0.0 test D:\Agentic Matrimony\saath-kit\packages\i18n
> node test/validate-translations.mjs

OK: en.json (68 keys)
OK: hi.json (68 keys)
OK: ta.json (68 keys)
```

### python suites (agents + matching) (exit 0)

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
  ok 2 e2e\onboarding.hi.spec.ts:5:5 › sign up and complete onboarding in Hindi (4.6s)

  2 passed (30.7s)
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

### P3 criterion 1+2 — A6 screening eval (real-Claude report, FI ≤ 10%) (exit 0)

```
screening_eval_real_20261026T102905Z.json: {} pass=true
```

### P3-09 — A4 explanation eval (real-Claude spot run) (exit 0)

```
explanation_eval_real_20261027T120505Z.json: {} pass=true
```

### P3-11 — bias-check eval (deterministic, protected-attribute parity) (exit 0)

```
bias_eval_20261027T143543Z.json: {} pass=true
```

### A9 moderation eval (real-Claude report, still binding from P2) (exit 0)

```
moderation_eval_real_20261025T123656Z.json: {} pass=true
```

### A2 golden-set eval (real-Claude report, still binding from P1) (exit 0)

```
extraction_eval_real_20261024T125914Z.json: {} pass=true
```

### P3 criterion 3 — 2k smoke benchmark (0 errors) + shown-counts fix (exit 0)

```
batch-benchmark-2000-2026-10-26T1233.json: errors=0 exitCode=0; fix + test present → PASS
```

### Planted secret blocked (exit 0)

```
canary detected, commit blocked (exit nonzero)
```

### gitleaks detect (clean repo) (exit 0)

```
    ○ ░
    ░    gitleaks

[90m9:07PM[0m [32mINF[0m 45 commits scanned.
[90m9:07PM[0m [32mINF[0m scan completed in 392ms
[90m9:07PM[0m [32mINF[0m no leaks found
```

### LLM SDK isolation (exit 0)

```
> saath@0.0.0 check:llm-isolation D:\Agentic Matrimony\saath-kit
> node scripts/check-llm-isolation.mjs

OK: all LLM SDK usage is confined to the LLM Gateway module.
```
