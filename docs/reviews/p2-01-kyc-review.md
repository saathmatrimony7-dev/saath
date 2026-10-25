# P2-01 review — KYC + verification tiers (security + privacy)

Scope: `modules/kyc` (KycProvider interface, mock + IDfy reference impl), `POST /v1/me/kyc`, signed `POST /v1/hooks/kyc`, `kyc_checks` table, tier/age application, underage block. Webhook HMAC helpers generalised into `common/hmac-signature.ts` (WhatsApp controller refactored onto them, same algorithm).

## Security — PASS

| Sev | Finding                                                                                                                                            | Disposition                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Low | KYC webhook: Zod 400 before signature 401 (shape probing)                                                                                          | Same accepted posture as the WhatsApp webhook (P1-09 review); vendor shape is public; fixed properly with the real vendor |
| Low | MockKycProvider providerRef is deterministic (`mock-kyc-<uid>-<n>-<type>`)                                                                         | Test-only provider; real providers mint unguessable refs; prod guardrail refuses mock                                     |
| —   | Signature: HMAC-SHA256 over raw body, constant-time, 401 on missing/invalid; dev default secret refused in production (guardrail test)             | No issue                                                                                                                  |
| —   | Idempotency: `webhook_events` (source `kyc`), first-writer-wins; processed/unknown refs ignored — replay test asserts no re-application            | No issue                                                                                                                  |
| —   | Tier writes run only in the owner RLS context; webhook writes only in `app.service = 'verification'`; monotonic tiers (fail never lowers) — tested | No issue                                                                                                                  |
| —   | Consent gate before start; blocked accounts cannot start new checks — tested                                                                       | No issue                                                                                                                  |

## Privacy — PASS

- **No raw documents**: table stores result, provider ref, score, provider age, masked ID only (§10.4) — enforced structurally (DTO has no document fields; nothing decodes/stores images).
- Exact DOB is never stored: provider age → `birthYear` (year only) + `ageVerified` flag.
- Underage is a hard signal: immediate `status=blocked`, check recorded `fail`/`underage` — tested.
- `kyc_checks` is owner-read (RLS) with a service-only write path; no admin/messaging exposure in this task.
- `birthYear` added to `GET /v1/me` (owner's own C3 data only).
