# Runbook: disaster recovery — restore drill (DESIGN.md §19 P5, §2.1)

**Targets:** RPO 15 min · RTO 4 h. **Cadence:** quarterly drill, evidence in
`docs/evidence/dr-drill-*.json`.

## Production path (RDS Postgres Multi-AZ + PITR)

1. **Detect & declare:** page the on-call (alert: RDS failover, corrupted
   instance, or regional loss). Declare severity S1/S2 per the incident
   matrix (incident-response.md).
2. **Snapshot/PITR restore:** in the DR region (`ap-south-2`), restore a new
   RDS instance from the latest automated snapshot + transaction logs to the
   point just before the incident (PITR console/CLI, `--restore-to-time`).
   This is the RPO step: choose a target time no later than 15 min before
   data loss.
3. **Verify before serving:** run the canary checks — row counts on
   `users`, `daily_matches`, `conversations`; open a read-only probe query
   for a known canary row; confirm migration version
   (`prisma migrate status`).
4. **Repoint & warm:** switch the app `DATABASE_URL` (Secrets Manager) to
   the restored instance; restart services; watch p95/error dashboards.
5. **Record:** restore duration, RPO actually achieved, issues → evidence
   JSON + post-incident review within 5 business days.

## Local drill (what CI runs)

`node scripts/dr-drill.mjs` — boots an embedded Postgres, migrates it,
writes a canary row, takes a consistent backup (physical copy of the
stopped instance — the embedded binaries ship no pg_dump/WAL tooling), then
restores a fresh instance from that backup and verifies the canary. It
fails the exit code when the restore exceeds `DR_RTO_MINUTES` (default 240).

This validates the *runbook mechanics* (backup exists, restore serves data,
RTO measurable). The PITR specifics above remain the production procedure.
