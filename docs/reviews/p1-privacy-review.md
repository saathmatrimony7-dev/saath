# P1 privacy review (full phase diff)

**Scope:** P1-01…P1-10. Method: DPDP Act lens (data classes, minimisation,
purpose limitation, residency, LLM flows) per DESIGN.md §2.2/§10, read of the
full diff + executable proofs.

## Findings

| Sev | Area | Finding | Status |
|-----|------|---------|--------|
| Low | A1 interview | Free-text answers may contain volunteered sensitive data before the user confirms; transcript is owner-visible only and the profile goes live only on explicit confirm | Accepted — confirm gate is the designed control (tested: 409 before, visibility flip after) |
| Low | WhatsApp | Meta will see message content when the real adapter activates | Known vendor transfer; consents gate the channel; DPA/account setup tracked with the deferred Meta integration (P2) |

No High/Critical findings remain open.

## Verified controls (with proof)

- **Data classes & controls:** C4 columns (phone, email) field-level encrypted;
  every new user-data table has FORCE RLS + owner/service policies (RLS suite
  extended in P1-10); photos served via short-lived HMAC-signed URLs; log
  redaction tested (packages/logger suite); PII never logged (rule 8 reviews).
- **Minimisation:** A2 extractor schema forbids raw transcript sentences
  (≤200-char normalised summaries, no third-party names) — structurally
  enforced, not prompt-faith; explicit-only extraction rule (never infer
  religion/community/caste) enforced in prompt + controlled vocabularies, and
  the "no inference of community" guard test has no code path setting community
  from name/text; webhook payload's `contacts[].name` is not consumed.
- **Purpose limitation:** consent ledger append-only with per-purpose rows;
  signup auto-records matchmaking + agent_screening; whatsapp consent is
  explicit (no consent → zero outbound, tested); opt-out keyword withdraws
  immediately (new ledger row, tested); withdrawal honoured by the sender.
- **LLM flows:** all model calls via the gateway (redaction, budgets, audit);
  minimum-necessary data in prompts; no cross-user raw text anywhere (the
  agent-to-agent channel does not exist yet; A2 outputs are schema-validated
  fields only — rule 6).
- **Residency:** embedded/local Postgres + local mocks in P1; AWS ap-south-1
  mandated in DESIGN.md for cloud infra (P2 Terraform).
- **Retention/deletion:** onboarding transcripts owner-only until confirm;
  session/token purges exist (OTP expiry); full retention/erasure jobs land
  with the notifications/admin scope (P2, noted in exit report deferrals).
- **Analytics:** none added in P1 (web app has no tracking; language switcher
  is a plain link).

**Verdict: PASS** (no open High/Critical; Lows accepted with documented rationale)
