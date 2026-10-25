# P2-03 review — reports & blocks (security + privacy)

Scope: `modules/safety` (reports + blocks), `blocks`/`user_reports` tables, `users_service_lookup` extended with the `safety` context, block wiring into `getPublicProfile`.

## Security — PASS

| Sev | Finding                                                                                                                                                                                                          | Disposition                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Low | `safety` service context can read any user row by id (needed to validate report/block targets)                                                                                                                   | Same exposure class as the existing identity/channels contexts; policy stays SELECT-only; no bulk endpoint exists |
| —   | `isBlockedEitherWay` initially queried under the caller's owner context, which RLS-correctly hides the reverse direction's row — fixed to run in the service context (regression test asserts both directions)   | Fixed in-task                                                                                                     |
| —   | Blocks: idempotent upsert, self-block rejected, `blocks_no_self_ck` DB check, unique pair constraint                                                                                                             | No issue                                                                                                          |
| —   | Reports: closed reason vocabulary (400 otherwise), append-only app role (no UPDATE/DELETE grants), open-report dedupe per reporter+subject pair, subject existence in service context (unknown → 404, no oracle) | No issue                                                                                                          |
| —   | Block list returns user ids only — no names/phones                                                                                                                                                               | No issue                                                                                                          |

## Privacy — PASS

- Reports store reason + optional ≤1000-char details; reporter identity is RLS-owner-scoped (only the reporter and the moderation service context can read).
- Blocks reveal nothing to either party beyond the list of ids the blocker themselves created.
- Blocked pairs are hidden both directions (`getPublicProfile` consults the check today; P3 search and P4 chat must call `SafetyService.isBlockedEitherWay` — noted in code and exit-report deferrals).
- No new PII fields; no analytics.
