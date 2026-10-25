# @saath/admin — Saath admin console (P2-06)

Internal back-office for the trust & safety team. **Staff-facing English-only
tool** (rule 14's i18n requirement covers user-facing UI; documented
deviation).

## What it does

- OTP login (same httpOnly-cookie + CSRF pattern as `apps/web`, via the
  same-origin `/api/core/*` rewrite proxy — no CORS).
- Case queue (open safety cases with resolve/dismiss + decision note).
- User directory (C4 masked by the API — phone/email never decrypted).
- Audit browser (the append-only admin trail).
- JIT elevation banner (staff roles can self-elevate for 15 minutes; every
  view and action is audited server-side, P2 exit criterion 3).

## Dev

`pnpm dev` (port 3102; Core API on `CORE_API_URL`, default
`http://127.0.0.1:3000`). Giving a dev account a staff role is a DB operation
(service/superuser context), e.g.:

```sql
UPDATE users SET role = 'admin' WHERE id = '<user-id>';
```

Role claims refresh on the next token rotation (`POST /v1/auth/refresh`).
