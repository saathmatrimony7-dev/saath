#!/usr/bin/env node
/**
 * Validates packages/i18n message files:
 *  - every locale file is valid JSON
 *  - every locale has exactly the same key set as the base locale (en)
 * Locales (DESIGN.md §1.3): en, hi, bn, mr, te, ta, gu, kn, ml, pa
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'messages');
const files = readdirSync(messagesDir).filter((f) => f.endsWith('.json'));

if (files.length === 0) {
  console.error('FAIL: no message files found');
  process.exit(1);
}

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

const base = JSON.parse(readFileSync(join(messagesDir, 'en.json'), 'utf8'));
const baseKeys = new Set(flatten(base));

let failed = false;
for (const file of files) {
  let data;
  try {
    data = JSON.parse(readFileSync(join(messagesDir, file), 'utf8'));
  } catch (err) {
    console.error(`FAIL: ${file} is not valid JSON: ${err.message}`);
    failed = true;
    continue;
  }
  const keys = new Set(flatten(data));
  const missing = [...baseKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !baseKeys.has(k));
  if (missing.length || extra.length) {
    console.error(`FAIL: ${file} key mismatch. missing=[${missing}] extra=[${extra}]`);
    failed = true;
  } else {
    console.log(`OK: ${file} (${keys.size} keys)`);
  }
}

process.exit(failed ? 1 : 0);
