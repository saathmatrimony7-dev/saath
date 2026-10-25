#!/usr/bin/env node
/**
 * P2 exit-criteria evidence runner (qa-engineer). Executes each check,
 * captures output, and writes docs/p2-exit-evidence.md.
 *
 * Exit criteria (DESIGN.md §19 P2):
 *  1. Unverified users cannot message
 *     — contact-gate tests (vitest, inside `pnpm test`) + `assertCanContact`
 *  2. Scam test scripts detected ≥ 90%
 *     — committed real-Claude A9 report is verified here; re-run with:
 *       REAL=1 uv run python -m evals.run_moderation_eval   (from services/agents)
 *  3. Every admin view audited
 *     — admin audit tests (vitest, inside `pnpm test`)
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

// Full suites — exit criteria 1 and 3 live inside (contact gate, admin audit).
run('pnpm test (API: RLS incl. P2 tables, authz matrix, KYC, safety, admin)', 'pnpm', ['test']);
run('packages/logger redaction tests', 'pnpm', ['--filter', '@saath/logger', 'test']);
run('i18n key parity (en/hi/ta)', 'pnpm', ['--filter', '@saath/i18n', 'test']);
run('python suites (agents + matching)', 'pnpm', ['test:py']);
run('Playwright web e2e (onboarding in English and Hindi)', 'pnpm', ['test:e2e']);

// Code quality gates.
run('pnpm lint', 'pnpm', ['lint']);
run('pnpm typecheck', 'pnpm', ['typecheck']);

// Exit criterion 2: A9 real-Claude report (and the P1 A2 report, still binding).
function checkReport(label, reportsDir, pattern, field) {
  console.log(`\n=== ${label} ===`);
  const files = readdirSync(reportsDir)
    .filter((f) => pattern.test(f))
    .sort();
  const latest = files.at(-1);
  if (!latest) {
    results.push({ name: label, code: 1, tail: `no report matching ${pattern} found` });
    console.log('FAIL: no report found');
    return;
  }
  const report = JSON.parse(readFileSync(join(reportsDir, latest), 'utf8'));
  const ok = report.pass === true;
  const tail = `${latest}: ${JSON.stringify(report[field] ?? {})} pass=${ok}`;
  results.push({ name: label, code: ok ? 0 : 1, tail });
  console.log(`exit=${ok ? 0 : 1}\n${tail}`);
}
checkReport(
  'A9 moderation eval (real-Claude report, recall threshold 90%)',
  join('services', 'agents', 'evals', 'reports'),
  /^moderation_eval_real_.*\.json$/,
  { recall: 'recall', precision: 'precision' },
);
checkReport(
  'A2 golden-set eval (real-Claude report, threshold 90%)',
  join('services', 'agents', 'evals', 'reports'),
  /^extraction_eval_real_.*\.json$/,
  { accuracy: 'accuracy' },
);

// Secrets scanning (tooling under .tools/, git-ignored).
const gitleaks = resolve('.tools/gitleaks/gitleaks.exe');
if (existsSync(gitleaks)) {
  let canaryBlocked = false;
  try {
    writeFileSync(
      'canary-p2-check.tmp',
      'ANTHROPIC_API_KEY=sk-ant-api03-P2EXITCRITERIONCANARY00000000',
    );
    execSync('git add canary-p2-check.tmp', { stdio: 'pipe' });
    const res = run('gitleaks protect --staged (planted canary MUST fail)', gitleaks, [
      'protect',
      '--staged',
      '--config',
      '.gitleaks.toml',
      '--redact',
    ]);
    canaryBlocked = !res;
    results.pop();
  } finally {
    execSync('git reset -q canary-p2-check.tmp', { stdio: 'pipe' });
    unlinkSync('canary-p2-check.tmp');
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

const tf = resolve('.tools/terraform/terraform.exe');
if (existsSync(tf)) {
  run('terraform fmt -check', tf, ['-chdir=infra/terraform', 'fmt', '-check', '-recursive']);
} else {
  skip('terraform fmt -check', 'terraform not installed (.tools/terraform missing)');
}

run('LLM SDK isolation', 'pnpm', ['check:llm-isolation']);

const allGreen = results.every((r) => r.code === 0);
const verdict = (r) => (r.skipped ? 'SKIP' : r.code === 0 ? 'PASS' : 'FAIL');
const md = [
  '# P2 exit-criteria evidence',
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
writeFileSync('docs/p2-exit-evidence.md', md);
console.log(
  `\nOverall: ${allGreen ? 'PASS' : 'FAIL'} — evidence written to docs/p2-exit-evidence.md`,
);
process.exit(allGreen ? 0 : 1);
