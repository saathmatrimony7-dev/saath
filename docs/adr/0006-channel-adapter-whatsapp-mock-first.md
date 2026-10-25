# ADR-0006: Messaging channels behind a ChannelAdapter; WhatsApp mock-first

**Status:** accepted · **Date:** 2026-10-24 · **Decided with:** owner (P1 plan, locked decision 2026-10-22)

## Context

DESIGN.md §10.2 requires a WhatsApp channel (Meta Cloud API) with explicit opt-in, templates for proactive messages, and keyword opt-out. The Meta business account is not available yet (owner). The same seam will later carry notifications (templates, quiet hours, per-channel preferences).

## Decision

- One `ChannelAdapter` interface (`sendText(toE164, text)`) is the only outbound messaging seam. WhatsApp is the first implementation.
- **Mock adapter now** (in-memory outbox; refused in production like every other mock vendor, enforced in `config.ts` guardrails). **MetaWhatsAppAdapter** implements the Cloud API send and is a config-only swap (`WHATSAPP_PROVIDER=meta` + credentials).
- Inbound is a signature-verified webhook (`POST /v1/hooks/whatsapp`): HMAC-SHA256 over the **raw body** (`x-hub-signature-256`, constant-time), idempotent `wamid` in a `webhook_events` table, GET verify-token handshake for the Meta subscription.
- The webhook drives the **same** `OnboardingService`/A1 engine as the web app — one engine, two channels. Outbound is gated on `whatsapp=granted`; the opt-out keyword (config) records an append-only withdrawal and stops all sends.

## Consequences

- Onboarding over WhatsApp is e2e-provable today (scripted mock, Hindi interview test); the Meta cutover is configuration, not code.
- Message bodies and phone numbers never enter logs; consent state is re-checked before every send.
- Deferred with the real Meta account (P2): IP allow-listing, proactive templates, 24-hour window enforcement, webhook rate limiting.
