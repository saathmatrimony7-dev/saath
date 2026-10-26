-- P3-03: the matching module resolves candidate users by id cross-user
-- (eligible pool + two-sided hard filters). Extend the pre-auth service lookup
-- (same exposure class as identity/channels/safety) — SELECT-only.
--
-- profiles / preferences / dealbreakers / blocks / photos already carry the
-- generic service-context policy (app.service non-empty → ALL), which covers
-- the 'matching' context — those policies are intentionally NOT narrowed here;
-- this migration only extends the users lookup IN-list.

DROP POLICY users_service_lookup ON "users";

CREATE POLICY users_service_lookup ON "users" FOR SELECT
  USING (current_setting('app.service', true) IN ('identity', 'channels', 'safety', 'admin', 'matching'));
