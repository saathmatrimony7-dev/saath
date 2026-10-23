/**
 * Consent ledger service (P1-02). Append-only: every grant/withdrawal is a new
 * row; `latest` derives current state per purpose from the ledger.
 */
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createLogger } from '@saath/logger';
import { PrismaService } from '../../prisma/prisma.service';
import type { AppConfig } from '../../config';
import { APP_CONFIG } from '../identity/tokens';
import {
  CONSENT_PURPOSES,
  isConsentPurpose,
  type ConsentChannel,
  type ConsentPurpose,
} from './consent.consts';

const logger = createLogger('consent');

export interface ConsentState {
  purpose: ConsentPurpose;
  granted: boolean | null; // null = never recorded
  noticeVersion: string | null;
  channel: ConsentChannel | null;
  updatedAt: string | null; // ISO timestamp of the latest row
}

export interface RecordedConsent {
  purpose: ConsentPurpose;
  granted: boolean;
  noticeVersion: string;
  channel: ConsentChannel;
  createdAt: string;
}

@Injectable()
export class ConsentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Current state for every known purpose (latest ledger row wins). */
  async latest(userId: string): Promise<ConsentState[]> {
    const rows = await this.prisma.withUser(userId, (tx) =>
      tx.consent.findMany({
        where: { userId },
        orderBy: [{ purpose: 'asc' }, { createdAt: 'desc' }],
      }),
    );
    const byPurpose = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (!byPurpose.has(r.purpose)) byPurpose.set(r.purpose, r); // first = latest
    }
    return CONSENT_PURPOSES.map((purpose) => {
      const row = byPurpose.get(purpose);
      return {
        purpose,
        granted: row?.granted ?? null,
        noticeVersion: row?.noticeVersion ?? null,
        channel: (row?.channel as ConsentChannel | null) ?? null,
        updatedAt: row?.createdAt?.toISOString() ?? null,
      };
    });
  }

  /** Appends one ledger row under the owner's RLS context. */
  async record(
    userId: string,
    purpose: string,
    granted: boolean,
    channel: ConsentChannel,
  ): Promise<RecordedConsent> {
    if (!isConsentPurpose(purpose)) {
      throw new BadRequestException(`unknown consent purpose: ${purpose}`);
    }
    const noticeVersion = this.config.CONSENT_NOTICE_VERSION;
    const row = await this.prisma.withUser(userId, (tx) =>
      tx.consent.create({
        data: { userId, purpose, granted, channel, noticeVersion },
      }),
    );
    logger.info({ userId, purpose, granted, channel }, 'consent recorded');
    return {
      purpose: row.purpose as ConsentPurpose,
      granted: row.granted,
      noticeVersion: row.noticeVersion,
      channel: row.channel as ConsentChannel,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
