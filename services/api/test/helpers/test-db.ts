import { readFileSync } from 'node:fs';
import { TEST_DB_URL_FILE } from '../global-setup';

/**
 * Returns the ephemeral test database URLs published by global-setup.
 * appUrl uses the non-superuser app_login role (RLS enforced) — use it for
 * everything except migrations/role admin.
 */
export function getTestDbUrls(): { adminUrl: string; appUrl: string } {
  return JSON.parse(readFileSync(TEST_DB_URL_FILE, 'utf8')) as {
    adminUrl: string;
    appUrl: string;
  };
}
