#!/usr/bin/env node
/**
 * P0 exit-criteria evidence runner (qa-engineer). Executes each check,
 * captures output, and writes docs/p0-exit-evidence.md.
 *
 * Exit criteria (DESIGN.md §19 P0):
 *  1. CI green
 *  2. RLS tests prove cross-user reads fail
 *  3. Secrets scanning blocks a planted test secret
 *  4. Redaction tests pass
 */
import { execSync, spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const isWin = process.platform === 'win32';
const results = [];

function run(name, cmd, args, opts = {}) {
  console.log(`\n=== ${name} ===`);
  const res = spawnSync(cmd, args, {
    stdio: 'pipe',
    // .exe / absolute paths don't need a shell; pnpm does on Windows
    shell: isWin && !cmd.endsWith('.exe'),
    encoding: 'utf8',
    ...opts,
  });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
  const lines = out.split('\n');
  const tail = lines.slice(-6).join('\n');
  results.push({ name, code: res.status ?? 1, tail });
  console.log(`exit=${res.status}\n${tail}`);
  return res.status === 0;
}

// 1+2+4: full test suite (RLS proofs + redaction tests live inside)
run('pnpm test (API: RLS proofs, auth, authz matrix, LLM gateway)', 'pnpm', ['test']);
run('packages/logger redaction tests', 'pnpm', ['--filter', '@saath/logger', 'test']);
run('python suites', 'pnpm', ['test:py']);

// 3: secrets scanning blocks a planted secret
const gitleaks = resolve('.tools/gitleaks/gitleaks.exe');
let canaryBlocked = false;
try {
  writeFileSync('canary-p0-check.tmp', 'ANTHROPIC_API_KEY=sk-ant-api03-P0EXITCRITERIONCANARY00000000');
  execSync('git add canary-p0-check.tmp', { stdio: 'pipe' });
  const res = run('gitleaks protect --staged (planted canary MUST fail)', gitleaks, [
    'protect', '--staged', '--config', '.gitleaks.toml', '--redact',
  ]);
  canaryBlocked = !res; // nonzero exit = blocked = pass
  results.pop(); // replaced by the semantic entry below
} finally {
  execSync('git reset -q canary-p0-check.tmp', { stdio: 'pipe' });
  unlinkSync('canary-p0-check.tmp');
}
results.push({
  name: 'Planted secret blocked',
  code: canaryBlocked ? 0 : 1,
  tail: canaryBlocked ? 'canary detected, commit blocked (exit nonzero)' : 'CANARY NOT DETECTED — FAIL',
});

// Clean repo scan
run('gitleaks detect (clean repo)', gitleaks, ['detect', '--source', '.', '--config', '.gitleaks.toml', '--redact']);

// Terraform fmt/validate (plan-only until AWS accounts exist)
const tf = resolve('.tools/terraform/terraform.exe');
run('terraform fmt -check', tf, ['-chdir=infra/terraform', 'fmt', '-check', '-recursive']);

// LLM SDK isolation
run('LLM SDK isolation', 'pnpm', ['check:llm-isolation']);

const allGreen = results.every((r) => r.code === 0);
const md = [
  '# P0 exit-criteria evidence',
  '',
  `Generated: ${new Date().toISOString()} (local run; CI re-runs all checks on every PR)`,
  '',
  '| Check | Result |',
  '|-------|--------|',
  ...results.map((r) => `| ${r.name} | ${r.code === 0 ? 'PASS' : 'FAIL'} |`),
  '',
  `**Overall: ${allGreen ? 'PASS' : 'FAIL'}**`,
  '',
  '## Output tails',
  ...results.flatMap((r) => [`### ${r.name} (exit ${r.code})`, '', '```', r.tail, '```', '']),
].join('\n');
writeFileSync('docs/p0-exit-evidence.md', md);
console.log(`\nOverall: ${allGreen ? 'PASS' : 'FAIL'} — evidence written to docs/p0-exit-evidence.md`);
process.exit(allGreen ? 0 : 1);
