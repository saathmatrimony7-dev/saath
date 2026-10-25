-- P1-09: the WhatsApp channel resolves an inbound sender to an account by
-- phone hash BEFORE a user context exists — the same pre-auth lookup path the
-- identity service has (see 20261021170000_otp_and_refresh_rotation). Recreate
-- the policy SELECT-only (the old one defaulted to ALL commands) and allow the
-- 'channels' service context alongside 'identity'.

DROP POLICY users_identity_lookup ON "users";

CREATE POLICY users_service_lookup ON "users" FOR SELECT
  USING (current_setting('app.service', true) IN ('identity', 'channels'));
