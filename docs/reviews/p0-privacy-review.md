# P0 Privacy Review — privacy-reviewer pass

**Scope:** P0 diff against DESIGN.md §2.2 (DPDP/IT Act/CERT-In) and §10 (classification & privacy rules).

## Data inventory introduced in P0

| Field                                    | Class      | Controls in place                                                               |
| ---------------------------------------- | ---------- | ------------------------------------------------------------------------------- |
| `users.phone_enc`                        | C4         | AES-256-GCM field encryption (`@saath/crypto`); never logged (logger key rules) |
| `users.phone_e164_hash`                  | C4-derived | HMAC-SHA256 (key separated via HKDF) — lookup only, non-reversible              |
| `users.email_enc`                        | C4         | Same as phone (column exists; populated from P1)                                |
| `sessions.ip_hash`, `refresh_token_hash` | C3         | HMAC/SHA-256 hashes only                                                        |
| `sessions.ua`                            | C2         | Truncated to 256 chars                                                          |
| `otp_codes.*`                            | C4-derived | Hashed phone + HMAC-peppered code; single-use; expired rows purged on reuse     |
| `llm_calls`                              | C2         | Metadata only (tokens/cost/model) — no prompts or content stored                |
| users.locale/gender/birth_year           | C3         | RLS + owner-only policies; birth_year only (no full DOB, §2.2 age-gate rule)    |

## Checks against §10.2

- **Minimisation:** ✅ only the fields above exist; no health data; no KYC documents (P2); full DOB absent by design.
- **LLM flows:** ✅ redaction before transport (proven by test); minimum fields — the gateway receives caller-supplied messages only; no cross-user data exists in P0 (no screening yet).
- **Community/religion/caste:** ✅ nowhere in schema or code; taxonomy lands in P1 as declared-filters only.
- **Residency:** ✅ Terraform pins `ap-south-1`; no data leaves the dev machine today. Anthropic call path exists but transport is `mock` everywhere in P0 — no user data has left the machine.
- **Retention/deletion:** ✅ OTP rows purged; account-level retention jobs are P5 scope (`privacy` module) — tracked, not a P0 gap.
- **Consent ledger:** P1 scope per plan (P1 includes consent ledger) — not a P0 gap.
- **Logs:** ✅ redaction logger; no PII/OTP/token logging anywhere in the diff (verified by tests + review).
- **Seed data:** ✅ synthetic only (ITU-T test-range numbers, hashed).

## Findings

| Severity | Issue                                                                                            | Disposition                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Low      | Expired OTP rows persisted until next request from same phone                                    | **FIXED** (purge-on-request in P0-12)                                                                                                  |
| Info     | `llm_calls.user_id` links AI usage to a user — needed for budgets; purpose-bound to cost control | **ACCEPTED** — purpose documented in code; revisit in P1 consent wiring (budget enforcement should be disclosed in the consent notice) |

**Verdict: PASS** — no High/Critical; the single Low was fixed.
