#!/usr/bin/env node
/**
 * P1-08 lint gate: proves no user-facing text is hard-coded in JSX.
 *
 * Rule 14 (AGENTS.md): all UI text comes from the i18n message files. This
 * script scans the tsx sources under src and flags any literal text child
 * between JSX tags (e.g. a paragraph containing Hello). Dynamic expressions ({t('…')}, {value})
 * are untouched; whitespace-only text is ignored. Strings in attributes,
 * hooks and logic are fine — the rule targets rendered text.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const srcDir = join(root, 'src');

/** Literal text between JSX open/close tags. `{`/`}` excluded (expressions). */
const JSX_TEXT = />[ \t]*([^<>{}][^<>{}]*)</g;
/** Any letter (ASCII, Devanagari, Tamil) means human-facing text. */
const HAS_LETTERS = /[A-Za-z\u0900-\u097F\u0B80-\u0BFF]/;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.tsx')) yield full;
  }
}

let failures = 0;
for (const file of walk(srcDir)) {
  const code = readFileSync(file, 'utf8');
  // Strip block comments (they may contain prose with < > characters).
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const match of stripped.matchAll(JSX_TEXT)) {
    const text = match[1]?.trim() ?? '';
    if (!text || !HAS_LETTERS.test(text)) continue;
    // TypeScript generics (useState<...>(...) etc.) mimic tag open/close —
    // real UI copy never contains statement/expression punctuation.
    if (/[();=]/.test(text)) continue;
    console.error(`FAIL ${relative(root, file)}: hard-coded JSX text "${text}"`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} hard-coded string(s) found — move them to packages/i18n/messages/*.json`,
  );
  process.exit(1);
}
console.log('OK: no hard-coded JSX text in apps/web/src');
