# A9 moderation eval — real run 20261025T123656Z

- items: 50 (abusive 40, safe 10), errors: 2
- **recall (scam-family): 90.0%**  (threshold 90% → PASS)
- **precision (safe negatives): 100.0%**  (floor 80% → PASS)
- missed: ['en02', 'hi08', 'hi09', 'hg01']
- false alarms: []
- **overall: PASS**

| id | lang | expected | got | conf | ok |
|----|------|----------|-----|------|----|
| en01 | en | money_request | money_request | 0.95 | ✓ |
| en02 | en | money_request | scam_script | 0.95 | ✗ |
| en03 | en | scam_script | scam_script | 0.70 | ✓ |
| en04 | en | scam_script | scam_script | 0.93 | ✓ |
| en05 | en | scam_script | scam_script | 0.97 | ✓ |
| en06 | en | off_platform_pressure | off_platform_pressure | 0.90 | ✓ |
| en07 | en | off_platform_pressure | off_platform_pressure | 0.72 | ✓ |
| en08 | en | money_request | money_request | 0.95 | ✓ |
| en09 | en | scam_script | scam_script | 0.93 | ✓ |
| en10 | en | money_request | money_request | 0.95 | ✓ |
| en11 | en | scam_script | scam_script | 0.95 | ✓ |
| en12 | en | scam_script | scam_script | 0.95 | ✓ |
| en13 | en | off_platform_pressure | off_platform_pressure | 0.95 | ✓ |
| en14 | en | money_request | money_request | 0.93 | ✓ |
| en15 | en | scam_script | scam_script | 0.93 | ✓ |
| en16 | en | scam_script | scam_script | 0.93 | ✓ |
| en17 | en | money_request | money_request | 0.93 | ✓ |
| en18 | en | off_platform_pressure | off_platform_pressure | 0.80 | ✓ |
| en19 | en | scam_script | scam_script | 0.92 | ✓ |
| en20 | en | money_request | money_request | 0.90 | ✓ |
| hi01 | hi | money_request | money_request | 0.95 | ✓ |
| hi02 | hi | scam_script | scam_script | 0.82 | ✓ |
| hi03 | hi | off_platform_pressure | off_platform_pressure | 0.85 | ✓ |
| hi04 | hi | money_request | money_request | 0.93 | ✓ |
| hi05 | hi | scam_script | scam_script | 0.93 | ✓ |
| hi06 | hi | scam_script | scam_script | 0.96 | ✓ |
| hi07 | hi | money_request | money_request | 0.93 | ✓ |
| hi08 | hi | money_request | scam_script | 0.93 | ✗ |
| hi09 | hi | off_platform_pressure | ERROR | 0.00 | ✗ |
| hi10 | hi | scam_script | scam_script | 0.95 | ✓ |
| hi11 | hi | money_request | money_request | 0.87 | ✓ |
| hi12 | hi | scam_script | scam_script | 0.94 | ✓ |
| hg01 | hinglish | money_request | ERROR | 0.00 | ✗ |
| hg02 | hinglish | off_platform_pressure | off_platform_pressure | 0.90 | ✓ |
| hg03 | hinglish | scam_script | scam_script | 0.96 | ✓ |
| hg04 | hinglish | money_request | money_request | 0.95 | ✓ |
| hg05 | hinglish | scam_script | scam_script | 0.97 | ✓ |
| hg06 | hinglish | money_request | money_request | 0.95 | ✓ |
| hg07 | hinglish | off_platform_pressure | off_platform_pressure | 0.90 | ✓ |
| hg08 | hinglish | scam_script | scam_script | 0.86 | ✓ |
| sf01 | en | safe | safe | 0.98 | ✓ |
| sf02 | en | safe | safe | 0.97 | ✓ |
| sf03 | en | safe | safe | 0.97 | ✓ |
| sf04 | en | safe | safe | 0.97 | ✓ |
| sf05 | en | safe | safe | 0.97 | ✓ |
| sf06 | hi | safe | safe | 0.98 | ✓ |
| sf07 | hi | safe | safe | 0.97 | ✓ |
| sf08 | hi | safe | safe | 0.98 | ✓ |
| sf09 | hinglish | safe | safe | 0.97 | ✓ |
| sf10 | hinglish | safe | safe | 0.97 | ✓ |