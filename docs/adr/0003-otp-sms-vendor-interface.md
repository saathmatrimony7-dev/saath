# ADR-0003: OTP SMS vendor behind an interface (MSG91 assumed)

**Status:** accepted · **Date:** 2026-10-21 · **Decided with:** owner (P0 Q5)

## Context

DESIGN.md lists "MSG91 / Twilio Verify". Owner: assume MSG91 for now; real account/keys come later (MSG91 needs DLT registration lead time in India).

## Decision

`SmsProvider` interface in `services/api/src/modules/identity/sms/sms-provider.ts`. Implementations: `MockSmsProvider` (dev/test in-memory outbox) and `Msg91SmsProvider` (config-driven HTTP). Provider selection via `OTP_PROVIDER` env; production boot refuses `mock`.

## Consequences

- Swapping vendors = one new class + config value.
- No vendor keys in the repo; real keys go to `.env.local` / Secrets Manager.
