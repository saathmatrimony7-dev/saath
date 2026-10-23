# P0 exit-criteria evidence

Generated: 2026-10-23T04:11:13.673Z (local run; CI re-runs all checks on every PR)

| Check | Result |
|-------|--------|
| pnpm test (API: RLS proofs, auth, authz matrix, LLM gateway) | PASS |
| packages/logger redaction tests | PASS |
| python suites | PASS |
| Planted secret blocked | PASS |
| gitleaks detect (clean repo) | FAIL |
| terraform fmt -check | PASS |
| LLM SDK isolation | PASS |

**Overall: FAIL**

## Output tails
### pnpm test (API: RLS proofs, auth, authz matrix, LLM gateway) (exit 0)

```
services/api test:  [32m✓[39m test/auth/config-guardrails.spec.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 20[2mms[22m[39m
services/api test: [2m Test Files [22m [1m[32m5 passed[39m[22m[90m (5)[39m
services/api test: [2m      Tests [22m [1m[32m33 passed[39m[22m[90m (33)[39m
services/api test: [2m   Start at [22m 09:40:47
services/api test: [2m   Duration [22m 16.92s[2m (transform 1.03s, setup 0ms, collect 4.44s, tests 2.46s, environment 2ms, prepare 656ms)[22m
services/api test: Done
```

### packages/logger redaction tests (exit 0)

```
 [32m✓[39m test/redact.spec.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 123[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m9 passed[39m[22m[90m (9)[39m
[2m   Start at [22m 09:41:06
[2m   Duration [22m 920ms[2m (transform 163ms, setup 0ms, collect 216ms, tests 123ms, environment 0ms, prepare 177ms)[22m
```

### python suites (exit 0)

```
plugins: platformdirs-4.13.5
collected 1 item

tests\test_matching_smoke.py .                                           [100%]

============================== 1 passed in 0.03s ==============================
```

### Planted secret blocked (exit 0)

```
canary detected, commit blocked (exit nonzero)
```

### gitleaks detect (clean repo) (exit 1)

```
    ○ ░
    ░    gitleaks

[90m9:41AM[0m [32mINF[0m 15 commits scanned.
[90m9:41AM[0m [32mINF[0m scan completed in 227ms
[90m9:41AM[0m [31mWRN[0m leaks found: 1
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
