#!/usr/bin/env node
/**
 * LLM isolation check (AGENTS.md rule 4): the Anthropic SDK may be imported
 * ONLY inside the llm-gateway module. Everything else must use the gateway.
 * Runs in CI (js-checks) and locally via `pnpm check:llm-isolation`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const ALLOWED = 'services/api/src/modules/llm-gateway';
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.venv',
  '.terraform',
  '.tools',
  '.pgdata',
]);
const SOURCE_EXT = new Set(['.ts', '.tsx', '.mts', '.py']);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (SOURCE_EXT.has(entry.slice(entry.lastIndexOf('.')))) yield full;
  }
}

let violations = 0;
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  if (rel.startsWith(ALLOWED)) continue;
  const content = readFileSync(file, 'utf8');
  if (/@anthropic-ai\/sdk/.test(content) || /from\s+['"]anthropic['"]/.test(content)) {
    console.error(`VIOLATION: ${rel} imports an LLM SDK outside the LLM Gateway`);
    violations++;
  }
}

if (violations > 0) process.exit(1);
console.log('OK: all LLM SDK usage is confined to the LLM Gateway module.');
