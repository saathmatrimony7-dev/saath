# Runbook: privacy — DSR operations (DESIGN.md §10.2, §2.2)

## Scheduled jobs

- **Retention sweeper:** `cd services/api && pnpm exec tsx scripts/privacy-sweeper.ts`
  — daily. Finishes erasure (`DELETE /v1/me` requests) past
  `PRIVACY_ERASE_RETENTION_DAYS` (30). Users with billing records are
  anonymised (identity nulled, C4 content destroyed, invoices/payments kept
  for the 8-year billing retention); everyone else is hard-deleted.
  Idempotent; safe to re-run.
- **Chats:** conversations closed > 12 months are purged unless reported —
  same sweep cadence (scheduled with the sweeper in prod).

## Access requests (export)

Self-serve: `POST /v1/me/export` returns the JSON immediately. If a user
cannot self-serve (lost device), staff verify identity out-of-band, then
generate the export from the PrivacyService (`exportUserData`) and deliver
over a signed, expiring link. Log every staff-generated export in the
admin audit trail.

## Grievances

1. User files via `POST /v1/me/grievances` (C4-encrypted, SLA clock starts:
   `GRIEVANCE_SLA_DAYS`, default 30).
2. Officer queue: `GET /v1/admin/grievances` (staff; SLA-breached surface
   first). Acknowledge within 24 h.
3. Resolve: `POST /v1/admin/grievances/:id/decide` with a resolution note —
   audited. Breach-risk grievances escalate to the incident-response path.

## Notice versions

`docs/legal/privacy-notice.md` + `docs/legal/terms.md` carry the version
that MUST match `CONSENT_NOTICE_VERSION` in `services/api/src/config.ts`.
Bump both together; never reuse an old version string.
