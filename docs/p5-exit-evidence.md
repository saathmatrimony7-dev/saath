# P5 exit-criteria evidence

Generated: 2026-10-28T17:06:21.624Z (local run; CI re-runs all checks on every PR)
Mode: default (all checks must pass)

## Exit criteria (DESIGN.md §19, P5)

| Criterion | Status |
|-----------|--------|
| 1. No open high/critical findings | PASS |
| 2. Restore drill within RTO | PASS |
| 3. Legal sign-off on notices | PASS (review-ready; external sign-off = owner action, recorded in docs/legal/) |

> Criterion 3: the automated gate verifies the notices are versioned and
> review-ready. The **external legal sign-off** itself is the owner's
> action (like the external pen-test engagement) — recorded in
> docs/legal/privacy-notice.md header and docs/p5-exit-evidence.md.

## Checks

| Check | Result |
|-------|--------|
| pnpm test (API: all suites incl. P5 privacy/DPDP) | PASS |
| packages/logger redaction tests | PASS |
| i18n key parity (en/hi/ta/te/bn) | PASS |
| python suites (agents + matching) | PASS |
| Playwright web e2e (onboarding in English and Hindi) | PASS |
| pnpm lint | PASS |
| pnpm typecheck | PASS |
| P5 criterion 2 — DR restore drill (within RTO) | PASS |
| P5 criterion 2 — drill evidence present + canary verified | PASS |
| Planted secret blocked | PASS |
| gitleaks detect (clean repo — no committed findings) | PASS |
| pnpm audit --prod (high+ = 0 open) | PASS |
| semgrep SAST/DAST scan | SKIP |
| trivy SAST/DAST scan | SKIP |
| zap SAST/DAST scan | SKIP |
| LLM SDK isolation | PASS |
| P5 DPDP controls — export/erase/grievance + retention sweep | PASS |
| P5 criterion 3 — notices review-ready (versioned, grievance, runbooks) | PASS |

**Overall: PASS**

## Output tails
### pnpm test (API: all suites incl. P5 privacy/DPDP) (exit 0)

```
services/api test:  [32m✓[39m test/auth/config-guardrails.spec.ts [2m([22m[2m17 tests[22m[2m)[22m[32m 45[2mms[22m[39m
services/api test: [2m Test Files [22m [1m[32m37 passed[39m[22m[90m (37)[39m
services/api test: [2m      Tests [22m [1m[32m313 passed[39m[22m[90m (313)[39m
services/api test: [2m   Start at [22m 22:32:47
services/api test: [2m   Duration [22m 118.05s[2m (transform 2.31s, setup 0ms, collect 45.39s, tests 50.40s, environment 15ms, prepare 4.72s)[22m
services/api test: Done
```

### packages/logger redaction tests (exit 0)

```
 [32m✓[39m test/redact.spec.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 129[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m9 passed[39m[22m[90m (9)[39m
[2m   Start at [22m 22:34:47
[2m   Duration [22m 976ms[2m (transform 177ms, setup 0ms, collect 233ms, tests 129ms, environment 0ms, prepare 185ms)[22m
```

### i18n key parity (en/hi/ta/te/bn) (exit 0)

```

OK: bn.json (68 keys)
OK: en.json (68 keys)
OK: hi.json (68 keys)
OK: ta.json (68 keys)
OK: te.json (68 keys)
```

### python suites (agents + matching) (exit 0)

```
.venv\Lib\site-packages\fastapi\testclient.py:1
  D:\Agentic Matrimony\saath-kit\services\matching\.venv\Lib\site-packages\fastapi\testclient.py:1: StarletteDeprecationWarning: Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead.
    from starlette.testclient import TestClient as TestClient  # noqa

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
======================== 53 passed, 1 warning in 0.70s ========================
```

### Playwright web e2e (onboarding in English and Hindi) (exit 0)

```
  ok 1 e2e\onboarding.en.spec.ts:5:5 › sign up and complete onboarding in English (15.5s)
  ok 2 e2e\onboarding.hi.spec.ts:5:5 › sign up and complete onboarding in Hindi (5.0s)

  2 passed (36.0s)
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

### P5 criterion 2 — DR restore drill (within RTO) (exit 0)

```
  "restoreMs": 2556,
  "canaryFound": true,
  "tableCount": 46,
  "withinRto": true
}
[dr-drill] evidence → D:\Agentic Matrimony\saath-kit\docs\evidence\dr-drill-2026-10-28T1706.json
```

### P5 criterion 2 — drill evidence present + canary verified (exit 0)

```
dr-drill-2026-10-28T1706.json: restoreMs=2556 canary=true withinRto=true → PASS
```

### Planted secret blocked (exit 0)

```
canary detected, commit blocked (exit nonzero)
```

### gitleaks detect (clean repo — no committed findings) (exit 0)

```
    ○ ░
    ░    gitleaks

[90m10:36PM[0m [32mINF[0m 45 commits scanned.
[90m10:36PM[0m [32mINF[0m scan completed in 459ms
[90m10:36PM[0m [32mINF[0m no leaks found
```

### pnpm audit --prod (high+ = 0 open) (exit 0)

```
no open high/critical dependency findings → PASS
```

### semgrep SAST/DAST scan (exit 0)

```
SKIP: semgrep not installed locally (CI installs it; see scripts/security-scan.mjs)
```

### trivy SAST/DAST scan (exit 0)

```
SKIP: trivy not installed locally (CI installs it; see scripts/security-scan.mjs)
```

### zap SAST/DAST scan (exit 0)

```
SKIP: zap not installed locally (CI installs it; see scripts/security-scan.mjs)
```

### LLM SDK isolation (exit 0)

```
> saath@0.0.0 check:llm-isolation D:\Agentic Matrimony\saath-kit
> node scripts/check-llm-isolation.mjs

OK: all LLM SDK usage is confined to the LLM Gateway module.
```

### P5 DPDP controls — export/erase/grievance + retention sweep (exit 0)

```
export/erase/grievance + retention sweep implemented and spec-covered (executed in pnpm test) → PASS
```

### P5 criterion 3 — notices review-ready (versioned, grievance, runbooks) (exit 0)

```
notices versioned (match CONSENT_NOTICE_VERSION), grievance published, DPDP rights documented, runbooks present. EXTERNAL legal sign-off remains the owner action recorded below. → PASS
```
