# P0 exit-criteria evidence

Generated: 2026-10-22T13:24:58.029Z (local run; CI re-runs all checks on every PR)

| Check | Result |
|-------|--------|
| pnpm test (API: RLS proofs, auth, authz matrix, LLM gateway) | PASS |
| packages/logger redaction tests | PASS |
| python suites | PASS |
| Planted secret blocked | PASS |
| gitleaks detect (clean repo) | PASS |
| terraform fmt -check | PASS |
| LLM SDK isolation | PASS |

**Overall: PASS**

## Output tails
### pnpm test (API: RLS proofs, auth, authz matrix, LLM gateway) (exit 0)

```
services/api test:  [32m✓[39m test/rls/rls.spec.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 197[2mms[22m[39m
services/api test: [2m Test Files [22m [1m[32m4 passed[39m[22m[90m (4)[39m
services/api test: [2m      Tests [22m [1m[32m29 passed[39m[22m[90m (29)[39m
services/api test: [2m   Start at [22m 18:54:39
services/api test: [2m   Duration [22m 12.26s[2m (transform 429ms, setup 0ms, collect 3.19s, tests 1.91s, environment 1ms, prepare 464ms)[22m
services/api test: Done
```

### packages/logger redaction tests (exit 0)

```
 [32m✓[39m test/redact.spec.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 113[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m9 passed[39m[22m[90m (9)[39m
[2m   Start at [22m 18:54:53
[2m   Duration [22m 820ms[2m (transform 147ms, setup 0ms, collect 193ms, tests 113ms, environment 0ms, prepare 151ms)[22m
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

### gitleaks detect (clean repo) (exit 0)

```
    ○ ░
    ░    gitleaks

[90m6:54PM[0m [32mINF[0m 13 commits scanned.
[90m6:54PM[0m [32mINF[0m scan completed in 192ms
[90m6:54PM[0m [32mINF[0m no leaks found
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
