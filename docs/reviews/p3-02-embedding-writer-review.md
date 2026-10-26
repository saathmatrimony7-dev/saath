# P3-02 Review — Normalised summary + embedding writer + provenance

**Date:** 2026-10-25 · **Scope:** `ProfileSnapshot`/`summary_builder`/`embed_snapshot` (services/matching), FastAPI `/internal/embed/profile`, provenance migration, `save_embedding` extension, `listStaleEmbeddings` · **Verdict: PASS** (no High/Critical; 2 accepted Lows)

## Security review

| Severity | Location | Finding | Disposition |
|----------|----------|---------|-------------|
| — | matching `app.py` | Internal endpoint guarded by HMAC-compared (`hmac.compare_digest`) service token; 401 on missing/wrong; strict 422 body; provider injectable for tests; no OpenAPI exposure | PASS |
| — | `snapshots.py` | Rule-6 guard at the type level: the snapshot schema has NO free-text/transcript field; `extra="forbid"` rejects anything Core didn't contract; control chars rejected; per-field length caps (test asserts a transcript field cannot be added) | PASS |
| — | `save_embedding` + `saveEmbedding` | Provenance validated pre-write (sha256 regex, ≤64-char model, positive-int versions, 400 otherwise); column names hard-coded; all values parameterised; vector literal still validated-numerics-only | PASS |
| — | `listStaleEmbeddings` | Limit validated (1..10000); static SQL, no user input; runs in transaction-local `'matching'` service context; not exposed as an HTTP endpoint | PASS |
| Low | `listStaleEmbeddings` cross-user read | Matching-domain service read of profiles+preferences is intentional and required by the pipeline; it must be re-checked when the P3-03 `users_service_lookup` policy extension lands (currently relies on existing profiles/preferences service policies) | Accepted (P3-03 dependency) |
| Info | deps | `fastapi`/`httpx`/`uvicorn` added to saath-matching; `sentence-transformers` locked as `[embed]` extra, not installed in the main venv (verified) | Accepted |

## Privacy review

| Severity | Location | Finding | Disposition |
|----------|----------|---------|-------------|
| — | Provenance columns | `embedding_summary_hash` = sha256 of the rendered summary — one-way, pseudonymous; version stamps + model name are operational metadata. No new personal data; C2 treatment inherited | PASS |
| — | Purpose / rule 10 | Only user-declared, matchmaking-purpose fields are embedded; `religion_label`/`community_label` are accepted on the snapshot for forward-compat but deliberately NOT embedded (declared filters only, rule 10) | PASS |
| — | Residency / LLM flow | No LLM call; local providers only; no cross-user data flow | PASS |
| Low | Stances in embeddings | `stances` (A2-normalised soft preferences) become recoverable-in-principle only via the vector — no raw text stored in the column; raw-text guarantee is contractual (snapshot schema) and type-enforced | Accepted (P3-05 adds the end-to-end leak test) |

**Reviewer conclusion:** PASS — proceed to P3-03.
