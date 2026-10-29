/**
 * Privacy retention sweeper (P5-01, DESIGN.md §10.2): finishes erasure for
 * DELETE /v1/me requests past PRIVACY_ERASE_RETENTION_DAYS. Runs the SAME
 * PrivacyService.applyRetention the API uses (one implementation, exercised
 * by tests). Schedule daily in prod (EventBridge/scheduler lands with P5
 * infra); safe to re-run — completed requests are skipped.
 *
 *   pnpm exec tsx scripts/privacy-sweeper.ts
 *
 * Exit 0 even when there is nothing to do; prints the counts for logs.
 */
import '../src/load-env'; // .env.local before anything else
import { FieldCrypto, EnvKeyProvider } from '@saath/crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { loadConfig } from '../src/config';
import { PrivacyService } from '../src/modules/privacy/privacy.service';

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const config = loadConfig();
    const privacy = new PrivacyService(prisma, config, new FieldCrypto(new EnvKeyProvider()));
    const result = await privacy.applyRetention();
    console.log(
      `[privacy-sweeper] retention window ${config.PRIVACY_ERASE_RETENTION_DAYS}d: ` +
        `${result.erased} hard-deleted, ${result.anonymised} anonymised (billing retention)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[privacy-sweeper] failed', err);
  process.exit(1);
});
