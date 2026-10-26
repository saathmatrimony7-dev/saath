# P3-04 Review — Retrieval (pgvector ANN) + pre-rank + exposure caps

**Date:** 2026-10-25 · **Scope:** `20261025231000_profiles_embedding_hnsw`, `retrieveCandidates`/`rankCandidates`/`applyExposureCap` in matching.service, config weights/caps, retrieval.spec.ts · **Verdict: PASS** (no High/Critical; 1 accepted Low)

## Security review

| Severity | Location | Finding | Disposition |
|----------|----------|---------|-------------|
| — | `retrieveCandidates` | Query vector literal re-built only from `parseVectorText`-validated numbers from the caller's own stored embedding (not request input); ids/limit parameterised; static SQL otherwise | PASS |
| — | `rankCandidates` | Reuses the P3-03 two-sided `hardFilterCheck` for reciprocity (no rule drift); runs in `'matching'` service context; output carries pseudonymous user ids + closed-vocab codes only | PASS |
| — | Config | topK/topN/weights/cap from config (rule 13), validated at use (positive ints) | PASS |
| Low | O(n) reciprocity queries | Per-candidate `hardFilterCheck` = ~200 round trips per user per batch; acceptable at §7.4.8's N=30/Stage-2 scale, needs batching before larger pools | Accepted (note for P3-07) |
| — | Migration | `CREATE INDEX IF NOT EXISTS` hnsw/vector_cosine_ops; documented exact-scan fallback keeps semantics identical without the index | PASS |

## Privacy review

| Severity | Location | Finding | Disposition |
|----------|----------|---------|-------------|
| — | Retrieval surface | Cross-user embedding reads only inside the matching service context for the matchmaking purpose; similarity scores are C2 aggregates | PASS |
| — | Rule 10 | Pre-rank "rule signals" use only declared same-city/same-diet/same-community equality — nothing inferred | PASS |

**Verification evidence:** retrieval ordering matches known cosine ground truth; ANN top-10 recall vs brute force asserted ≥ 0.9 (HNSW at this scale is ~1.0); ineligible/no-embedding users excluded; `EmbeddingMissingError` typed for the P3-07 orchestrator; exposure-cap pure function unit-tested; full suite 22 files green; lint + typecheck clean.

**Reviewer conclusion:** PASS — proceed to P3-05 (the broker protocol + exit-criterion-1 leak test).
