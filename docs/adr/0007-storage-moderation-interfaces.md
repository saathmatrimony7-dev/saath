# ADR-0007: Photo storage + moderation behind interfaces; local mocks in P1

**Status:** accepted · **Date:** 2026-10-24 · **Decided with:** owner (P1 plan; Q5 photo limits; locked decision 2026-10-22)

## Context

Photos are sensitive user data (C3): they need private object storage, payload scanning, and moderation before visibility. AWS accounts do not exist yet (ADR-0005), so S3 and Rekognition are unavailable.

## Decision

- `StorageProvider` interface with a disk-backed **mock** (HMAC-signed short-lived URLs, `STORAGE_DIR`, refused in production) and an S3 stub. Photos are served **only** through signed GET URLs (TTL from config, default 15 min).
- `ModerationProvider` interface with a **mock** (flagged images never become visible; the row keeps `url = null`). Rekognition is the real implementation later.
- Upload flow is fixed server-side: presigned PUT → server re-encode via **sharp** (strips EXIF and embedded payloads; serves only re-encoded bytes) → moderate the served bytes → then mark visible. MIME/size/count caps are config (`PHOTOS_MAX_*`).
- Wrong-MIME and oversize uploads are rejected; signed-URL tampering and expiry return 401 (tested).

## Consequences

- The trust boundary (never serve raw uploaded bytes) is enforced in code today, not deferred with the vendor swap.
- Cutover to S3 + Rekognition is config + credentials; no flow changes.
- Deferred: real Rekognition thresholds/categories, CDN delivery, duplicate detection via `phash` (column exists).
