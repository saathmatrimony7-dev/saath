# P1 exit-criteria evidence

Generated: 2026-10-25T03:59:29.856Z (local run; CI re-runs all checks on every PR)

| Check | Result |
|-------|--------|
| pnpm test (API: RLS incl. P1 tables, authz matrix, onboarding en/hi, whatsapp channel) | PASS |
| packages/logger redaction tests | PASS |
| i18n key parity (en/hi/ta) | PASS |
| python suites (agents + matching) | PASS |
| Playwright web e2e (onboarding in English and Hindi) | PASS |
| pnpm lint | PASS |
| pnpm typecheck | PASS |
| A2 golden-set eval (real-Claude report) | PASS |
| Planted secret blocked | PASS |
| gitleaks detect (clean repo) | PASS |
| terraform fmt -check | PASS |
| LLM SDK isolation | PASS |

**Overall: PASS**

## Output tails
### pnpm test (API: RLS incl. P1 tables, authz matrix, onboarding en/hi, whatsapp channel) (exit 0)

```
services/api test:  [32m✓[39m test/auth/config-guardrails.spec.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 26[2mms[22m[39m
services/api test: [2m Test Files [22m [1m[32m12 passed[39m[22m[90m (12)[39m
services/api test: [2m      Tests [22m [1m[32m115 passed[39m[22m[90m (115)[39m
services/api test: [2m   Start at [22m 09:27:30
services/api test: [2m   Duration [22m 32.26s[2m (transform 905ms, setup 0ms, collect 12.41s, tests 9.16s, environment 5ms, prepare 1.47s)[22m
services/api test: Done
```

### packages/logger redaction tests (exit 0)

```
 [32m✓[39m test/redact.spec.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 117[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m9 passed[39m[22m[90m (9)[39m
[2m   Start at [22m 09:28:04
[2m   Duration [22m 966ms[2m (transform 177ms, setup 0ms, collect 239ms, tests 117ms, environment 0ms, prepare 184ms)[22m
```

### i18n key parity (en/hi/ta) (exit 0)

```
> @saath/i18n@0.0.0 test D:\Agentic Matrimony\saath-kit\packages\i18n
> node test/validate-translations.mjs

OK: en.json (33 keys)
OK: hi.json (33 keys)
OK: ta.json (33 keys)
```

### python suites (agents + matching) (exit 0)

```
plugins: platformdirs-4.13.5
collected 1 item

tests\test_matching_smoke.py .                                           [100%]

============================== 1 passed in 0.03s ==============================
```

### Playwright web e2e (onboarding in English and Hindi) (exit 0)

```
Running 2 tests using 1 worker

  ✓  1 e2e\onboarding.en.spec.ts:5:5 › sign up and complete onboarding in English (18.0s)
  ✓  2 e2e\onboarding.hi.spec.ts:5:5 › sign up and complete onboarding in Hindi (4.5s)

  2 passed (50.5s)
```

### pnpm lint (exit 0)

```
packages/crypto lint: Done
apps/web lint$ node scripts/check-i18n.mjs
services/api lint$ eslint .
apps/web lint: OK: no hard-coded JSX text in apps/web/src
apps/web lint: Done
services/api lint: Done
```

### pnpm typecheck (exit 0)

```
packages/crypto typecheck: Done
packages/logger typecheck: Done
apps/web typecheck$ tsc --noEmit
services/api typecheck$ tsc --noEmit -p tsconfig.json
apps/web typecheck: Done
services/api typecheck: Done
```

### A2 golden-set eval (real-Claude report) (exit 0)

```
extraction_eval_real_20261024T125914Z.json: accuracy 91.3% (209/229), threshold 90% → PASS
```

### Planted secret blocked (exit 0)

```
canary detected, commit blocked (exit nonzero)
```

### gitleaks detect (clean repo) (exit 0)

```
    ○ ░
    ░    gitleaks

[90m9:29AM[0m [32mINF[0m 28 commits scanned.
[90m9:29AM[0m [32mINF[0m scan completed in 304ms
[90m9:29AM[0m [32mINF[0m no leaks found
```

### terraform fmt -check (exit 0)

```

```

### LLM SDK isolation (exit 0)

```
> saath@0.0.0 check:llm-isolation D:\Agentic Matrimony\saath-kit
> node scripts/check-llm-isolation.mjs

OK: all LLM SDK usage is confined to the LLM Gateway module.
```
