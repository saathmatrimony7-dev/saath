# A9 moderation eval — mock run 20261025T055515Z

- items: 50 (abusive 40, safe 10), errors: 0
- **recall (scam-family): 20.0%**  (threshold 90% → FAIL)
- **precision (safe negatives): 50.0%**  (floor 80% → FAIL)
- missed: ['en01', 'en02', 'en03', 'en05', 'en06', 'en07', 'en08', 'en09', 'en10', 'en11', 'en13', 'en14', 'en15', 'en17', 'en18', 'en19', 'en20', 'hi01', 'hi03', 'hi04', 'hi05', 'hi07', 'hi08', 'hi09', 'hi11', 'hg01', 'hg02', 'hg03', 'hg04', 'hg05', 'hg06', 'hg07']
- false alarms: ['sf02', 'sf04', 'sf06', 'sf08', 'sf10']
- **overall: FAIL**

| id | lang | expected | got | conf | ok |
|----|------|----------|-----|------|----|
| en01 | en | money_request | safe | 0.90 | ✗ |
| en02 | en | money_request | scam_script | 0.90 | ✗ |
| en03 | en | scam_script | safe | 0.90 | ✗ |
| en04 | en | scam_script | scam_script | 0.90 | ✓ |
| en05 | en | scam_script | safe | 0.90 | ✗ |
| en06 | en | off_platform_pressure | scam_script | 0.90 | ✗ |
| en07 | en | off_platform_pressure | safe | 0.90 | ✗ |
| en08 | en | money_request | scam_script | 0.90 | ✗ |
| en09 | en | scam_script | safe | 0.90 | ✗ |
| en10 | en | money_request | scam_script | 0.90 | ✗ |
| en11 | en | scam_script | safe | 0.90 | ✗ |
| en12 | en | scam_script | scam_script | 0.90 | ✓ |
| en13 | en | off_platform_pressure | safe | 0.90 | ✗ |
| en14 | en | money_request | scam_script | 0.90 | ✗ |
| en15 | en | scam_script | safe | 0.90 | ✗ |
| en16 | en | scam_script | scam_script | 0.90 | ✓ |
| en17 | en | money_request | safe | 0.90 | ✗ |
| en18 | en | off_platform_pressure | scam_script | 0.90 | ✗ |
| en19 | en | scam_script | safe | 0.90 | ✗ |
| en20 | en | money_request | scam_script | 0.90 | ✗ |
| hi01 | hi | money_request | safe | 0.90 | ✗ |
| hi02 | hi | scam_script | scam_script | 0.90 | ✓ |
| hi03 | hi | off_platform_pressure | safe | 0.90 | ✗ |
| hi04 | hi | money_request | scam_script | 0.90 | ✗ |
| hi05 | hi | scam_script | safe | 0.90 | ✗ |
| hi06 | hi | scam_script | scam_script | 0.90 | ✓ |
| hi07 | hi | money_request | safe | 0.90 | ✗ |
| hi08 | hi | money_request | scam_script | 0.90 | ✗ |
| hi09 | hi | off_platform_pressure | safe | 0.90 | ✗ |
| hi10 | hi | scam_script | scam_script | 0.90 | ✓ |
| hi11 | hi | money_request | safe | 0.90 | ✗ |
| hi12 | hi | scam_script | scam_script | 0.90 | ✓ |
| hg01 | hinglish | money_request | safe | 0.90 | ✗ |
| hg02 | hinglish | off_platform_pressure | scam_script | 0.90 | ✗ |
| hg03 | hinglish | scam_script | safe | 0.90 | ✗ |
| hg04 | hinglish | money_request | scam_script | 0.90 | ✗ |
| hg05 | hinglish | scam_script | safe | 0.90 | ✗ |
| hg06 | hinglish | money_request | scam_script | 0.90 | ✗ |
| hg07 | hinglish | off_platform_pressure | safe | 0.90 | ✗ |
| hg08 | hinglish | scam_script | scam_script | 0.90 | ✓ |
| sf01 | en | safe | safe | 0.90 | ✓ |
| sf02 | en | safe | scam_script | 0.90 | ✗ |
| sf03 | en | safe | safe | 0.90 | ✓ |
| sf04 | en | safe | scam_script | 0.90 | ✗ |
| sf05 | en | safe | safe | 0.90 | ✓ |
| sf06 | hi | safe | scam_script | 0.90 | ✗ |
| sf07 | hi | safe | safe | 0.90 | ✓ |
| sf08 | hi | safe | scam_script | 0.90 | ✗ |
| sf09 | hinglish | safe | safe | 0.90 | ✓ |
| sf10 | hinglish | safe | scam_script | 0.90 | ✗ |