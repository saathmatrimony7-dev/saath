#!/usr/bin/env node
/**
 * P1 exit-criteria evidence runner (qa-engineer). Executes each check,
 * captures output, and writes docs/p1-exit-evidence.md.
 *
 * Exit criteria (DESIGN.md §19 P1):
 *  1. User completes onboarding in Hindi and English
 *     — scripted API interviews (vitest) + Playwright web e2e (en/hi)
 *  2. Extracted profile accuracy ≥ 90% on the golden set (real Claude run)
 *     — committed eval report is verified here; re-run with:
 *       REAL=1 uv run python -m evals.run_extraction_eval   (from services/agents)
 *  3. Consents recorded — signup auto-records (consent spec inside pnpm test)
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

function skip(name, reason) {
  console.log(`\n=== ${name} ===\nSKIP: ${reason}`);
  results.push({ name, code: 0, tail: `SKIP: ${reason}`, skipped: true });
  return true;
}

// 1: full suites — API (RLS proofs incl. P1 tables, authz matrix incl. P1
//    rows, scripted onboarding interviews in en/hi, whatsapp channel, consents)
//    + python agents (A1 state machine, golden-set plumbing, redteam seed).
run(
  'pnpm test (API: RLS incl. P1 tables, authz matrix, onboarding en/hi, whatsapp channel)',
  'pnpm',
  ['test'],
);
run('packages/logger redaction tests', 'pnpm', ['--filter', '@saath/logger', 'test']);
run('i18n key parity (en/hi/ta)', 'pnpm', ['--filter', '@saath/i18n', 'test']);
run('python suites (agents + matching)', 'pnpm', ['test:py']);

// 1 (exit criterion): browser e2e — signup + full onboarding in en AND hi.
run('Playwright web e2e (onboarding in English and Hindi)', 'pnpm', ['test:e2e']);

// Code quality gates.
run('pnpm lint', 'pnpm', ['lint']);
run('pnpm typecheck', 'pnpm', ['typecheck']);

// 2 (exit criterion): A2 golden-set accuracy from the committed real-Claude
// report. The eval runner itself enforces the 90% threshold (exit code); here
// we verify the recorded evidence is present and passing.
console.log('\n=== A2 golden-set eval (real-Claude report, threshold 90%) ===');
{
  const reportsDir = join('services', 'agents', 'evals', 'reports');
  const real = readdirSync(reportsDir)
    .filter((f) => /^extraction_eval_real_.*\.json$/.test(f))
    .sort()
    .at(-1);
  if (!real) {
    results.push({
      name: 'A2 golden-set eval (real-Claude report)',
      code: 1,
      tail: 'no extraction_eval_real_*.json report found — run REAL=1 uv run python -m evals.run_extraction_eval',
    });
    console.log('FAIL: no real-mode report found');
  } else {
    const report = JSON.parse(readFileSync(join(reportsDir, real), 'utf8'));
    const ok = report.pass === true && report.accuracy >= report.threshold;
    const tail =
      `${real}: accuracy ${(report.accuracy * 100).toFixed(1)}% ` +
      `(${report.matched}/${report.checks}), threshold ${(report.threshold * 100).toFixed(0)}% → ${ok ? 'PASS' : 'FAIL'}`;
    results.push({ name: 'A2 golden-set eval (real-Claude report)', code: ok ? 0 : 1, tail });
    console.log(`exit=${ok ? 0 : 1}\n${tail}`);
  }
}

// Secrets scanning blocks a planted test secret (tooling checked in under
// .tools/, git-ignored; install with the setup in the README if missing).
const gitleaks = resolve('.tools/gitleaks/gitleaks.exe');
if (existsSync(gitleaks)) {
  let canaryBlocked = false;
  try {
    writeFileSync(
      'canary-p1-check.tmp',
      'ANTHROPIC_API_KEY=sk-ant-api03-P1EXITCRITERIONCANARY00000000',
    );
    execSync('git add canary-p1-check.tmp', { stdio: 'pipe' });
    const res = run('gitleaks protect --staged (planted canary MUST fail)', gitleaks, [
      'protect',
      '--staged',
      '--config',
      '.gitleaks.toml',
      '--redact',
    ]);
    canaryBlocked = !res; // nonzero exit = blocked = pass
    results.pop(); // replaced by the semantic entry below
  } finally {
    execSync('git reset -q canary-p1-check.tmp', { stdio: 'pipe' });
    unlinkSync('canary-p1-check.tmp');
  }
  results.push({
    name: 'Planted secret blocked',
    code: canaryBlocked ? 0 : 1,
    tail: canaryBlocked
      ? 'canary detected, commit blocked (exit nonzero)'
      : 'CANARY NOT DETECTED — FAIL',
  });
  run('gitleaks detect (clean repo)', gitleaks, [
    'detect',
    '--source',
    '.',
    '--config',
    '.gitleaks.toml',
    '--redact',
  ]);
} else {
  skip('Planted secret blocked', 'gitleaks not installed (.tools/gitleaks missing)');
  skip('gitleaks detect (clean repo)', 'gitleaks not installed (.tools/gitleaks missing)');
}

// Terraform fmt/validate (plan-only until AWS accounts exist).
const tf = resolve('.tools/terraform/terraform.exe');
if (existsSync(tf)) {
  run('terraform fmt -check', tf, ['-chdir=infra/terraform', 'fmt', '-check', '-recursive']);
} else {
  skip('terraform fmt -check', 'terraform not installed (.tools/terraform missing)');
}

// LLM SDK isolation
run('LLM SDK isolation', 'pnpm', ['check:llm-isolation']);

const allGreen = results.every((r) => r.code === 0);
const verdict = (r) => (r.skipped ? 'SKIP' : r.code === 0 ? 'PASS' : 'FAIL');
const md = [
  '# P1 exit-criteria evidence',
  '',
  `Generated: ${new Date().toISOString()} (local run; CI re-runs all checks on every PR)`,
  '',
  '| Check | Result |',
  '|-------|--------|',
  ...results.map((r) => `| ${r.name} | ${verdict(r)} |`),
  '',
  `**Overall: ${allGreen ? 'PASS' : 'FAIL'}**`,
  '',
  '## Output tails',
  ...results.flatMap((r) => [`### ${r.name} (exit ${r.code})`, '', '```', r.tail, '```', '']),
].join('\n');
writeFileSync('docs/p1-exit-evidence.md', md);
console.log(
  `\nOverall: ${allGreen ? 'PASS' : 'FAIL'} — evidence written to docs/p1-exit-evidence.md`,
);
process.exit(allGreen ? 0 : 1);
