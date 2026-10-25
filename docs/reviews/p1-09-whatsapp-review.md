# P1-09 review — WhatsApp channel (security + privacy)

Scope: `modules/channels` (ChannelAdapter, mock + Meta adapters), signature-verified `POST /v1/hooks/whatsapp`, `webhook_events` idempotency table, `users_service_lookup` RLS policy change, consent-gated outbound, opt-out keyword. No web/app changes; same A1 engine reused.

## Security — PASS

| Sev | Finding | Disposition |
|-----|---------|-------------|
| Low | Zod schema validation (400) runs before signature verification (401), so payload-shape probing is possible without the secret | The webhook envelope shape is Meta-public documentation; no user data or internals are revealed. Fixing requires pre-parse middleware — defer to real Meta integration (P2) |
| Low | No rate limit / IP allow-list on `/hooks/whatsapp` | DESIGN.md allows "IP allow-listed where possible"; Meta retries are deduped by wamid; defer with the real Meta integration (P2) |
| — | Signature: HMAC-SHA256 over the **raw body** (body-parser `verify` stash in main.ts / test-app / e2e-serve), constant-time compare, 401 on missing/invalid | No issue |
| — | Idempotency: `webhook_events` PK on wamid, first-writer-wins (unique-violation catch), replays ignored — tested | No issue |
| — | `users_service_lookup` policy replaces the ALL-command `users_identity_lookup` with **SELECT-only** scoped to `app.service IN ('identity','channels')`; service code queries by unique hash only (same exposure identity already had) | No issue |
| — | Webhook secret / Meta token from env only; dev default refused in production (guardrail test added) | No issue |
| — | No message bodies or phone numbers in logs (rule 8); mock outbox is memory-only test tooling | No issue |

## Privacy — PASS

- WhatsApp consent is explicit (§10.2): every outbound send is gated on `whatsapp=granted` — no consent → inbound is acked with HTTP 200 but zero messages (tested).
- Opt-out keyword → append-only withdrawal row (`granted=false`, channel `whatsapp`) + one acknowledgment, then silence even on further inbound (tested).
- `contacts[].profile.name` from the vendor payload is **not** consumed or stored (data minimisation).
- Inbound text flows into the existing `onboarding_messages` pipeline (same RLS/retention as the web channel); no new PII fields, no new purposes, no analytics.
- Locale detection uses message script only (UX language, never community — rule 10).
