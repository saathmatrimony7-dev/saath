# P2-06 review — admin console v1 + JIT + audit (security + privacy)

Scope: `users.role` + JWT role claim, `admin_elevations` (JIT), `admin_audit` (append-only), AdminGuard/AdminJitController/AdminService, `apps/admin` console, scoped RLS migrations (`users_admin_update`).

## Security — PASS

| Sev | Finding                                                                                                                                                                                  | Disposition                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Low | Role claim is JWT-cached (stale ≤ the 10-min access TTL after a role change)                                                                                                             | By design (JWT semantics); refresh rotates the claim — documented in the admin README                                                         |
| Low | Solo mode allows self-grant of JIT elevation                                                                                                                                             | Locked decision (P2 Q4): SSO/MFA + second-admin approval arrive with the Workspace accounts (P5); self-grants are logged with reason + expiry |
| —   | JIT endpoints deliberately NOT behind AdminGuard (chicken-and-egg for staff); AuthGuard + staff-role set check instead — caught in review, regression-tested (member self-elevation 403) | Fixed in-task                                                                                                                                 |
| —   | `admin_elevations`: one active grant per user, expiry enforced (rewound-grant test → 403), explicit drop, idempotent re-elevate                                                          | No issue                                                                                                                                      |
| —   | `admin_audit`: append-only (SELECT+INSERT grants only), service-context access, ids/kinds + bounded meta — never record contents                                                         | No issue                                                                                                                                      |
| —   | Every handler records a view/action row; tests assert rows per endpoint (exit criterion 3)                                                                                               | No issue                                                                                                                                      |
| —   | CSRF on all admin mutations; AdminGuard re-verifies the token (no reliance on guard ordering)                                                                                            | No issue                                                                                                                                      |

## Privacy — PASS

- **C4 masked by default (T7)**: admin responses return `••••••` for phone/email — `*_enc` is never decrypted for admin v1; the unmask flow (with its own audited action) is P5 hardening scope.
- The user directory/detail exposes profile/safety context needed for moderation decisions — purpose-aligned with the `agent_screening`/safety mandate; no new consent purpose introduced.
- The audit log stores subject ids/kinds only — a leaked log row cannot reveal record contents.
- Admin reads run in the dedicated `admin` service context; the `users_admin_update` policy is scoped to exactly that context and no other service can update roles.
