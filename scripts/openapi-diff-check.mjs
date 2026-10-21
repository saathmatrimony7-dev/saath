#!/usr/bin/env node
/**
 * OpenAPI diff check.
 * - While services/api has no generated spec yet (early P0), this is a no-op pass.
 * - Once services/api/openapi.json exists, the spec is regenerated and must be
 *   identical to the committed file (prevents undocumented API changes).
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const specPath = 'services/api/openapi.json';

if (!existsSync(specPath)) {
  console.log('SKIP: services/api/openapi.json does not exist yet (API under construction).');
  process.exit(0);
}

const gen = spawnSync('pnpm', ['--filter', '@saath/api', 'run', 'openapi:generate'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (gen.status !== 0) process.exit(gen.status ?? 1);

const diff = spawnSync('git', ['diff', '--exit-code', '--', specPath], { stdio: 'inherit' });
if (diff.status !== 0) {
  console.error('FAIL: committed OpenAPI spec is stale. Regenerate and commit it.');
  process.exit(1);
}
console.log('OK: OpenAPI spec is up to date.');
