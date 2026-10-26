# A6 screening eval — mock run 20261026T102442Z

- pairs: 66 (stage-2 60, stage-1 6), errors: 0
- **false-incompatible rate: 0.0%** (0/44, max 10% → PASS)
- overall agreement: 45.5%
- stage-1 short-circuit wrong: []
- per-language (stage-2): en: 0/30 FI, hi: 0/18 FI, hinglish: 0/12 FI
- **overall: PASS**

| id | lang | stage | adversarial | expected | got | score | ok |
|----|------|-------|-------------|----------|-----|-------|----|
| scr-en-001 | en | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-en-002 | en | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-en-003 | en | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-en-004 | en | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-en-005 | en | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-en-006 | en | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-en-007 | en | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-en-008 | en | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-en-009 | en | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-en-010 | en | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-en-011 | en | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-en-012 | en | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-en-013 | en | 2 | ✱ | partial | COMPATIBLE | 1.00 | ✗ |
| scr-en-014 | en | 2 | ✱ | partial | COMPATIBLE | 1.00 | ✗ |
| scr-en-015 | en | 2 |  | partial | COMPATIBLE | 1.00 | ✗ |
| scr-en-016 | en | 2 | ✱ | partial | COMPATIBLE | 1.00 | ✗ |
| scr-en-017 | en | 2 | ✱ | partial | COMPATIBLE | 1.00 | ✗ |
| scr-en-018 | en | 2 |  | partial | COMPATIBLE | 1.00 | ✗ |
| scr-en-019 | en | 2 | ✱ | partial | COMPATIBLE | 1.00 | ✗ |
| scr-en-020 | en | 2 |  | partial | COMPATIBLE | 1.00 | ✗ |
| scr-en-021 | en | 2 |  | partial | COMPATIBLE | 1.00 | ✗ |
| scr-en-022 | en | 2 | ✱ | partial | COMPATIBLE | 1.00 | ✗ |
| scr-en-023 | en | 2 |  | incompatible | COMPATIBLE | 1.00 | ✗ |
| scr-en-024 | en | 2 |  | incompatible | COMPATIBLE | 1.00 | ✗ |
| scr-en-025 | en | 2 |  | incompatible | COMPATIBLE | 1.00 | ✗ |
| scr-en-026 | en | 2 |  | incompatible | COMPATIBLE | 1.00 | ✗ |
| scr-en-027 | en | 2 | ✱ | incompatible | COMPATIBLE | 1.00 | ✗ |
| scr-en-028 | en | 2 |  | incompatible | COMPATIBLE | 1.00 | ✗ |
| scr-en-029 | en | 2 | ✱ | incompatible | COMPATIBLE | 1.00 | ✗ |
| scr-en-030 | en | 2 |  | incompatible | COMPATIBLE | 1.00 | ✗ |
| scr-hi-001 | hi | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-hi-002 | hi | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-hi-003 | hi | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-hi-004 | hi | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-hi-005 | hi | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-hi-006 | hi | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-hi-007 | hi | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-hi-008 | hi | 2 | ✱ | partial | COMPATIBLE | 1.00 | ✗ |
| scr-hi-009 | hi | 2 | ✱ | partial | COMPATIBLE | 1.00 | ✗ |
| scr-hi-010 | hi | 2 | ✱ | partial | COMPATIBLE | 1.00 | ✗ |
| scr-hi-011 | hi | 2 | ✱ | partial | COMPATIBLE | 1.00 | ✗ |
| scr-hi-012 | hi | 2 |  | partial | COMPATIBLE | 1.00 | ✗ |
| scr-hi-013 | hi | 2 |  | partial | COMPATIBLE | 1.00 | ✗ |
| scr-hi-014 | hi | 2 |  | incompatible | COMPATIBLE | 1.00 | ✗ |
| scr-hi-015 | hi | 2 |  | incompatible | COMPATIBLE | 1.00 | ✗ |
| scr-hi-016 | hi | 2 |  | incompatible | COMPATIBLE | 1.00 | ✗ |
| scr-hi-017 | hi | 2 | ✱ | incompatible | COMPATIBLE | 1.00 | ✗ |
| scr-hi-018 | hi | 2 |  | incompatible | COMPATIBLE | 1.00 | ✗ |
| scr-hin-001 | hinglish | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-hin-002 | hinglish | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-hin-003 | hinglish | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-hin-004 | hinglish | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-hin-005 | hinglish | 2 |  | compatible | COMPATIBLE | 1.00 | ✓ |
| scr-hin-006 | hinglish | 2 | ✱ | partial | COMPATIBLE | 1.00 | ✗ |
| scr-hin-007 | hinglish | 2 | ✱ | partial | COMPATIBLE | 1.00 | ✗ |
| scr-hin-008 | hinglish | 2 |  | partial | COMPATIBLE | 1.00 | ✗ |
| scr-hin-009 | hinglish | 2 | ✱ | partial | COMPATIBLE | 1.00 | ✗ |
| scr-hin-010 | hinglish | 2 |  | incompatible | COMPATIBLE | 1.00 | ✗ |
| scr-hin-011 | hinglish | 2 |  | incompatible | COMPATIBLE | 1.00 | ✗ |
| scr-hin-012 | hinglish | 2 | ✱ | incompatible | COMPATIBLE | 1.00 | ✗ |
| scr-s1-en-01 | en | 1 |  | incompatible | INCOMPATIBLE | 0.00 | ✓ |
| scr-s1-en-02 | en | 1 |  | incompatible | INCOMPATIBLE | 0.00 | ✓ |
| scr-s1-hi-01 | hi | 1 |  | incompatible | INCOMPATIBLE | 0.00 | ✓ |
| scr-s1-hi-02 | hi | 1 |  | incompatible | INCOMPATIBLE | 0.00 | ✓ |
| scr-s1-hin-01 | hinglish | 1 |  | incompatible | INCOMPATIBLE | 0.00 | ✓ |
| scr-s1-hin-02 | hinglish | 1 |  | incompatible | INCOMPATIBLE | 0.00 | ✓ |