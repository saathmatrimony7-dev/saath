#!/usr/bin/env node
/**
 * Cross-platform equivalent of `make security` (Makefile is canonical for CI/Linux).
 * Runs: gitleaks, semgrep, trivy, pnpm audit, pip-audit.
 * Each tool must be installed locally; CI installs them on the runner.
 */
import { spawnSync } from 'node:child_process';

const isWin = process.platform === 'win32';
const steps = [
  ['gitleaks', ['detect', '--source', '.', '--redact']],
  [
    'semgrep',
    [
      'scan',
      '--config',
      'p/owasp-top-ten',
      '--config',
      'p/secrets',
      '--error',
      '--exclude',
      'node_modules',
      '--exclude',
      '.venv',
      '.',
    ],
  ],
  [
    'trivy',
    ['fs', '--scanners', 'vuln,secret,misconfig', '--skip-dirs', 'node_modules,.venv,.git', '.'],
  ],
  ['pnpm', ['audit', '--prod']],
];

let failed = false;
for (const [cmd, args] of steps) {
  console.log(`\n=== ${cmd} ${args.join(' ')} ===`);
  const res = spawnSync(isWin ? `${cmd}.exe` : cmd, args, {
    stdio: 'inherit',
    shell: isWin,
  });
  if (res.error && res.error.code === 'ENOENT') {
    console.warn(`SKIP: ${cmd} not installed locally (runs in CI)`);
    continue;
  }
  if (res.status !== 0) failed = true;
}

// Python dependency audits
for (const svc of ['services/agents', 'services/matching']) {
  console.log(`\n=== pip-audit (${svc}) ===`);
  const res = spawnSync('uv', ['run', '--project', svc, 'pip-audit'], {
    stdio: 'inherit',
    shell: isWin,
  });
  if (res.error && res.error.code === 'ENOENT') {
    console.warn('SKIP: uv not installed');
    continue;
  }
  if (res.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
