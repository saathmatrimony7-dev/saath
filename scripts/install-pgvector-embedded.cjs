/* eslint-disable @typescript-eslint/no-require-imports -- CJS by design (see header) */
/**
 * P3-01 (ADR-0012): install a locally-BUILT pgvector into the embedded-Postgres
 * binaries used by the test harness / e2e server.
 *
 * The `embedded-postgres` npm package ships trimmed MSVC binaries with no
 * extensions and no build headers, and this dev box has no Docker. pgvector is
 * therefore compiled from source (pinned tag) with the VS Build Tools against
 * PostgreSQL 16.14 headers, then the artifacts are copied next to the embedded
 * binaries (native/lib, native/share/extension). That build is a ONE-TIME,
 * machine-local step driven by .tools/pgvector-spike/build-all.cmd (git-ignored);
 * this installer only copies the artifacts and is a no-op when already present.
 *
 * Cloud/dev Docker environments use pgvector/pgvector:pg16 where the extension
 * is preinstalled — the installer is a no-op there too (it only touches the
 * embedded binaries).
 *
 * CJS so both the vitest global-setup and e2e-serve (CJS-transpiled TS) can
 * require() it.
 */
const { createRequire } = require('node:module');
const { copyFileSync, existsSync, mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

const repoRoot = join(__dirname, '..');
const apiDir = join(repoRoot, 'services', 'api');
const buildDir = join(repoRoot, '.tools', 'pgvector-spike', 'pgvector');

/** Absolute path to the @embedded-postgres/windows-x64 native dir. */
function embeddedNativeDir() {
  const require = createRequire(join(apiDir, 'package.json'));
  const distEntry = require.resolve('@embedded-postgres/windows-x64');
  return join(dirname(distEntry), '..', 'native');
}

/**
 * Idempotent. Throws with build instructions when the pgvector build artifacts
 * are missing and the embedded binaries do not already have the extension.
 */
function installPgvectorEmbedded() {
  const native = embeddedNativeDir();
  const destDll = join(native, 'lib', 'vector.dll');
  if (existsSync(destDll)) return { installed: false, alreadyPresent: true };

  const srcDll = join(buildDir, 'vector.dll');
  const srcControl = join(buildDir, 'vector.control');
  const srcSql = join(buildDir, 'sql', 'vector--0.8.0.sql');
  const missing = [srcDll, srcControl, srcSql].filter((p) => !existsSync(p));
  if (missing.length > 0) {
    throw new Error(
      'pgvector is not installed in the embedded Postgres binaries and no local ' +
        'build was found (.tools/pgvector-spike/pgvector). Run the one-time build:\n' +
        '  .tools/pgvector-spike/build-all.cmd\n' +
        '(VS Build Tools + a one-time ~210 MB download of PG source + Windows SDK ' +
        'NuGet packages; see .tools/pgvector-spike/README.md and ADR-0012).',
    );
  }

  mkdirSync(join(native, 'share', 'extension'), { recursive: true });
  copyFileSync(srcDll, destDll);
  copyFileSync(srcControl, join(native, 'share', 'extension', 'vector.control'));
  copyFileSync(srcSql, join(native, 'share', 'extension', 'vector--0.8.0.sql'));
  return { installed: true, alreadyPresent: false };
}

/** CLI entry: node scripts/install-pgvector-embedded.cjs */
if (require.main === module) {
  const r = installPgvectorEmbedded();
  console.log(
    r.alreadyPresent
      ? '[pgvector] embedded Postgres already has vector.dll'
      : '[pgvector] installed vector.dll into embedded Postgres',
  );
}

module.exports = { installPgvectorEmbedded, embeddedNativeDir };
