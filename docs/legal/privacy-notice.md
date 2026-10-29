# Privacy notice (Saath)

**Version:** 2026-10-23.v1 — matches `CONSENT_NOTICE_VERSION` in `services/api/src/config.ts`.
Bump both together whenever this text changes (the consent ledger stamps the
version on every grant/withdrawal).

> Review status: drafted for legal review. External legal sign-off is the
> owner's action recorded in docs/p5-exit-evidence.md (DESIGN.md §19 P5
> criterion 3).

## What we collect

- **Account:** phone number (hashed + encrypted; never shown), optional email
  (encrypted), year of birth (never full DOB except optional horoscope opt-in),
  gender, locale.
- **Profile & preferences:** self-declared profile fields, partner
  preferences, dealbreakers, photos (EXIF stripped; visible watermark).
- **Verification:** KYC results and provider references only — raw ID
  documents are never stored (masked ID last-4 at most).
- **Matching & screening:** embeddings of the normalised profile summary
  (never raw free text), screening verdicts with reason codes.
- **Messaging:** chat bodies are encrypted at rest (C4) and are never used
  for any purpose except delivering your conversation and safety
  moderation (redacted before any model call).
- **Billing:** plan, subscription state, payments and GST invoices (retained
  8 years by law).
- **Consents:** an append-only ledger of every grant/withdrawal per purpose.

## Purposes & the consent ledger

Separate, granular consents: matchmaking, agent screening, Family Mode
sharing, WhatsApp communication, KYC, marketing. Each is withdrawable from
Settings or `PUT /v1/me/consents/{purpose}`; withdrawal takes effect
immediately for new processing (and within 24 hours for any scheduled
batch), recorded as a new ledger row.

## Your rights (DPDP Act 2023)

- **Access / portability:** `POST /v1/me/export` — a JSON export of
  everything you own, including decrypted conversation records.
- **Correction:** edit profile/preferences anytime (`PATCH /v1/me/profile`);
  contradictory extraction flags are re-confirmed with you.
- **Erasure:** `DELETE /v1/me` — the account is deactivated immediately
  (sessions revoked, profile hidden); a retention sweep finishes erasure
  within 30 days. Accounts with billing history are anonymised (identity
  removed, all content destroyed) because billing records must be kept for
  8 years.
- **Grievance:** `POST /v1/me/grievances` — reaches the Grievance Officer
  with a statutory SLA (30 days). Track status via
  `GET /v1/me/grievances`.

## Retention

Deleted accounts: hard-deleted (or anonymised when billing records exist)
within 30 days. Chats: deleted 12 months after a conversation closes unless
reported. Security logs: 180 days (CERT-In). Billing records: 8 years.
KYC document images: never retained.

## Contact

Grievance Officer: grievance@saath.example (publish the production address
and physical address here before launch — owner action).
