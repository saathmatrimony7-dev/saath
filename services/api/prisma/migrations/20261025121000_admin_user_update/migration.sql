-- P2-06: the admin service context may read users (directory) and update
-- account-level fields it manages (role, status). SELECT stays shared with
-- the other pre-auth contexts; UPDATE is a separate, scoped policy.

DROP POLICY users_service_lookup ON "users";

CREATE POLICY users_service_lookup ON "users" FOR SELECT
  USING (current_setting('app.service', true) IN ('identity', 'channels', 'safety', 'admin'));

CREATE POLICY users_admin_update ON "users" FOR UPDATE
  USING (current_setting('app.service', true) = 'admin')
  WITH CHECK (current_setting('app.service', true) = 'admin');
