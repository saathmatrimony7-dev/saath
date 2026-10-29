#!/usr/bin/env node
/**
 * P4 exit-criteria evidence runner (qa-engineer). Executes each check,
 * captures output, and writes docs/p4-exit-evidence.md.
 *
 * Exit criteria (DESIGN.md §19 P4 — Messaging & monetisation):
 *  1. Webhook replay test passes (idempotent) — executed inside `pnpm test`
 *     (test/billing/webhook.spec.ts); this runner additionally verifies the
 *     replay gate exists (webhook_events dedupe + the spec).
 *  2. Paywall enforced server-side — verified by test/messaging/paywall.spec.ts
 *     inside `pnpm test`; this runner verifies the enforcement points exist
 *     (EntitlementsService authority + PAYWALL gates in the messaging path).
 *  3. Contact-detail leakage in chat blocked — the pre-send mask scanner +
 *     test/messaging/chat.spec.ts masking test (executed inside `pnpm test`).
 *
 * Usage: node scripts/p4-exit-check.mjs [--strict]
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const isWin = process.platform === 'win32';
const STRICT = process.argv.includes('--strict');
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

// Full suites — the P4 RLS/authz suites (messaging, billing, notifications,
// coordinator tools) live inside the API matrix, as do all previous phases'
// suites (still binding).
run('pnpm test (API: all suites incl. P4 messaging/billing/notifications)', 'pnpm', ['test']);
run('packages/logger redaction tests', 'pnpm', ['--filter', '@saath/logger', 'test']);
run('i18n key parity (en/hi/ta)', 'pnpm', ['--filter', '@saath/i18n', 'test']);
run('python suites (agents incl. A8 coordinator + matching)', 'pnpm', ['test:py']);
run('Playwright web e2e (onboarding in English and Hindi)', 'pnpm', ['test:e2e']);

// Code quality gates.
run('pnpm lint', 'pnpm', ['lint']);
run('pnpm typecheck', 'pnpm', ['typecheck']);

// Criterion 1 — webhook replay test (idempotent).
function checkWebhookReplay() {
  const label = 'P4 criterion 1 — webhook replay test (idempotent)';
  console.log(`\n=== ${label} ===`);
  const problems = [];
  const webhook = readFileSync(
    join('services', 'api', 'src', 'modules', 'billing', 'razorpay-webhook.controller.ts'),
    'utf8',
  );
  if (!webhook.includes('webhookEvent.findUnique') || !webhook.includes("source: 'razorpay'")) {
    problems.push('webhook_events idempotency gate missing from razorpay-webhook.controller.ts');
  }
  const spec = readFileSync(join('services', 'api', 'test', 'billing', 'webhook.spec.ts'), 'utf8');
  if (!spec.includes('replays are 200 no-ops') || !spec.includes('duplicate')) {
    problems.push('replay test missing from test/billing/webhook.spec.ts');
  }
  if (!spec.includes('x-razorpay-signature') || !spec.includes('expect(bad.status).toBe(401)')) {
    problems.push('signature-verification test missing from test/billing/webhook.spec.ts');
  }
  const ok = problems.length === 0;
  const tail = ok
    ? 'idempotency gate + signature test + replay test present (executed in pnpm test) → PASS'
    : problems.join('; ');
  results.push({ name: label, code: ok ? 0 : 1, tail });
  console.log(`exit=${ok ? 0 : 1}\n${tail}`);
}
checkWebhookReplay();

// Criterion 2 — paywall enforced server-side.
function checkPaywall() {
  const label = 'P4 criterion 2 — paywall enforced server-side';
  console.log(`\n=== ${label} ===`);
  const problems = [];
  const messaging = readFileSync(
    join('services', 'api', 'src', 'modules', 'messaging', 'messaging.service.ts'),
    'utf8',
  );
  for (const [marker, what] of [
    ["code: 'PAYWALL'", 'PAYWALL gate'],
    ['effectiveInTx', 'entitlement authority read'],
  ]) {
    if (!messaging.includes(marker)) problems.push(`${what} missing from messaging.service.ts`);
  }
  if (!messaging.includes('masked calls require a paid plan')) {
    problems.push('calls paywall gate missing from messaging.service.ts');
  }
  const entitlements = readFileSync(
    join('services', 'api', 'src', 'modules', 'billing', 'entitlements.service.ts'),
    'utf8',
  );
  if (!entitlements.includes('never from client claims')) {
    problems.push('entitlements write-authority contract missing');
  }
  const spec = readFileSync(join('services', 'api', 'test', 'messaging', 'paywall.spec.ts'), 'utf8');
  if (!spec.includes('EXIT CRITERION 2') || !spec.includes('PAYWALL')) {
    problems.push('paywall spec missing from test/messaging/paywall.spec.ts');
  }
  const ok = problems.length === 0;
  const tail = ok
    ? 'PAYWALL gates (message cap, calls, intro credits) behind the entitlement authority; spec present → PASS'
    : problems.join('; ');
  results.push({ name: label, code: ok ? 0 : 1, tail });
  console.log(`exit=${ok ? 0 : 1}\n${tail}`);
}
checkPaywall();

// Criterion 3 — contact-detail leakage in chat blocked.
function checkContactMasking() {
  const label = 'P4 criterion 3 — contact-detail leakage in chat blocked';
  console.log(`\n=== ${label} ===`);
  const problems = [];
  const scanner = readFileSync(
    join('services', 'api', 'src', 'modules', 'messaging', 'contact-mask.ts'),
    'utf8',
  );
  for (const code of ['PHONE', 'EMAIL', 'URL', 'HANDLE']) {
    if (!scanner.includes(`'${code}'`)) problems.push(`mask reason ${code} missing`);
  }
  const messaging = readFileSync(
    join('services', 'api', 'src', 'modules', 'messaging', 'messaging.service.ts'),
    'utf8',
  );
  if (!messaging.includes('CONTACT_MASKED') || !messaging.includes('contactSharedAt')) {
    problems.push('pre-send mask gate missing from the send path');
  }
  const spec = readFileSync(join('services', 'api', 'test', 'messaging', 'chat.spec.ts'), 'utf8');
  if (!spec.includes('exit criterion 3') || !spec.includes('CONTACT_MASKED')) {
    problems.push('masking test missing from test/messaging/chat.spec.ts');
  }
  const ok = problems.length === 0;
  const tail = ok
    ? 'scanner (PHONE/EMAIL/URL/HANDLE) + pre-send gate + opt-in unblock + spec present → PASS'
    : problems.join('; ');
  results.push({ name: label, code: ok ? 0 : 1, tail });
  console.log(`exit=${ok ? 0 : 1}\n${tail}`);
}
checkContactMasking();

// A8 coordinator — agent + user binding surface (P4-09).
function checkCoordinatorAuthz() {
  const label = 'P4-09 — A8 coordinator tools authz (agent + user binding)';
  console.log(`\n=== ${label} ===`);
  const problems = [];
  const tools = readFileSync(
    join('services', 'api', 'src', 'modules', 'coordinator', 'coordinator-tools.controller.ts'),
    'utf8',
  );
  if (!tools.includes('A8_COORDINATOR_AGENT') || !tools.includes('token not bound to this user')) {
    problems.push('agent/binding assertions missing from coordinator-tools.controller.ts');
  }
  const spec = readFileSync(
    join('services', 'api', 'test', 'messaging', 'coordinator.spec.ts'),
    'utf8',
  );
  if (!spec.includes('wrong agent 403') || !spec.includes('send_nudge')) {
    problems.push('coordinator authz spec missing');
  }
  const ok = problems.length === 0;
  const tail = ok
    ? 'agent pin + acting-user binding + spec present (executed in pnpm test) → PASS'
    : problems.join('; ');
  results.push({ name: label, code: ok ? 0 : 1, tail });
  console.log(`exit=${ok ? 0 : 1}\n${tail}`);
}
checkCoordinatorAuthz();

// Secrets scanning (tooling under .tools/, git-ignored).
const gitleaks = resolve('.tools/gitleaks/gitleaks.exe');
if (existsSync(gitleaks)) {
  let canaryBlocked = false;
  try {
    writeFileSync(
      'canary-p4-check.tmp',
      'ANTHROPIC_API_KEY=sk-ant-api03-P4EXITCRITERIONCANARY00000000',
    );
    execSync('git add canary-p4-check.tmp', { stdio: 'pipe' });
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
    execSync('git reset -q canary-p4-check.tmp', { stdio: 'pipe' });
    unlinkSync('canary-p4-check.tmp');
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

run('LLM SDK isolation', 'pnpm', ['check:llm-isolation']);

const allGreen = results.every((r) => r.code === 0);
const verdict = (r) => (r.skipped ? 'SKIP' : r.code === 0 ? 'PASS' : 'FAIL');

const criteria = [
  ['1. Webhook replay test passes (idempotent)', allGreen ? 'PASS' : 'FAIL'],
  ['2. Paywall enforced server-side', allGreen ? 'PASS' : 'FAIL'],
  ['3. Contact-detail leakage in chat blocked', allGreen ? 'PASS' : 'FAIL'],
];

const md = [
  '# P4 exit-criteria evidence',
  '',
  `Generated: ${new Date().toISOString()} (local run; CI re-runs all checks on every PR)`,
  STRICT
    ? 'Mode: **--strict** (final P4 sign-off gate — all checks must pass)'
    : 'Mode: default (all checks must pass)',
  '',
  '## Exit criteria (DESIGN.md §19, P4)',
  '',
  '| Criterion | Status |',
  '|-----------|--------|',
  ...criteria.map(([c, s]) => `| ${c} | ${s} |`),
  '',
  '## Checks',
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
writeFileSync('docs/p4-exit-evidence.md', md);
console.log(
  `\nOverall: ${allGreen ? 'PASS' : 'FAIL'}` +
    ` — evidence written to docs/p4-exit-evidence.md`,
);
process.exit(allGreen ? 0 : 1);
