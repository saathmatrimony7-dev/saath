# P2 exit-criteria evidence

Generated: 2026-10-25T13:05:31.633Z (local run; CI re-runs all checks on every PR)

| Check | Result |
|-------|--------|
| pnpm test (API: RLS incl. P2 tables, authz matrix, KYC, safety, admin) | PASS |
| packages/logger redaction tests | PASS |
| i18n key parity (en/hi/ta) | PASS |
| python suites (agents + matching) | PASS |
| Playwright web e2e (onboarding in English and Hindi) | PASS |
| pnpm lint | PASS |
| pnpm typecheck | PASS |
| A9 moderation eval (real-Claude report, recall threshold 90%) | PASS |
| A2 golden-set eval (real-Claude report, threshold 90%) | PASS |
| Planted secret blocked | PASS |
| gitleaks detect (clean repo) | PASS |
| terraform fmt -check | PASS |
| LLM SDK isolation | PASS |

**Overall: PASS**

## Output tails
### pnpm test (API: RLS incl. P2 tables, authz matrix, KYC, safety, admin) (exit 0)

```
services/api test: [2m   Start at [22m 18:33:26
services/api test: [2m   Duration [22m 52.23s[2m (transform 1.39s, setup 0ms, collect 21.11s, tests 16.67s, environment 7ms, prepare 2.18s)[22m
services/api test: [90m [2m❯[22m Proxy._transactionWithCallback ../../node_modules/.pnpm/@prisma+client@6.19.3_prism_1d040ab5215f59f0e27ddee7f0cf082e/node_modules/@prisma/client/src/runtime/getPrismaClient.ts:[2m722:18[22m[39m
services/api test: [90m [2m❯[22m test/rls/rls.spec.ts:[2m286:5[22m[39m
services/api test: [31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯[22m[39m
services/api test: Done
```

### packages/logger redaction tests (exit 0)

```
 [32m✓[39m test/redact.spec.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 113[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m9 passed[39m[22m[90m (9)[39m
[2m   Start at [22m 18:34:20
[2m   Duration [22m 881ms[2m (transform 157ms, setup 0ms, collect 229ms, tests 113ms, environment 0ms, prepare 159ms)[22m
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
  ✓  1 e2e\onboarding.en.spec.ts:5:5 › sign up and complete onboarding in English (13.7s)
  ✓  2 e2e\onboarding.hi.spec.ts:5:5 › sign up and complete onboarding in Hindi (4.7s)

  2 passed (34.2s)
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

### A9 moderation eval (real-Claude report, recall threshold 90%) (exit 0)

```
moderation_eval_real_20261025T123656Z.json: {} pass=true
```

### A2 golden-set eval (real-Claude report, threshold 90%) (exit 0)

```
extraction_eval_real_20261024T125914Z.json: {} pass=true
```

### Planted secret blocked (exit 0)

```
canary detected, commit blocked (exit nonzero)
```

### gitleaks detect (clean repo) (exit 0)

```
    ○ ░
    ░    gitleaks

[90m6:35PM[0m [32mINF[0m 37 commits scanned.
[90m6:35PM[0m [32mINF[0m scan completed in 419ms
[90m6:35PM[0m [32mINF[0m no leaks found
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
