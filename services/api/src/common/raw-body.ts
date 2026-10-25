/**
 * Raw-body capture for webhook signature verification (P1-09).
 * The WhatsApp HMAC covers the exact bytes Meta sent, so a re-serialised
 * JSON body is not enough — body-parser stashes the raw buffer on the request
 * during parsing (same recipe in main.ts, the test boot helper and e2e-serve).
 */
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

export function stashRawBody(app: INestApplication): void {
  (app as NestExpressApplication).useBodyParser('json', {
    verify: (req: { rawBody?: Buffer }, _res: unknown, buf: Buffer) => {
      req.rawBody = buf;
    },
  });
}
