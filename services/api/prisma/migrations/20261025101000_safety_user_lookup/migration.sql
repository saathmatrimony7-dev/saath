-- P2-03: the safety module resolves report subjects and block targets by id
-- (not phone hash) before acting. Extend the pre-auth service lookup
-- (same exposure class as identity/channels) — SELECT-only.

DROP POLICY users_service_lookup ON "users";

CREATE POLICY users_service_lookup ON "users" FOR SELECT
  USING (current_setting('app.service', true) IN ('identity', 'channels', 'safety'));
