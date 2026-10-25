/**
 * WhatsApp inbound processing (P1-09). Drives the SAME A1 session engine as
 * the web app (OnboardingService) — one engine, two channels:
 *
 *   signature-verified webhook → idempotent (wamid) → user lookup by phone
 *   → opt-out keyword (consent withdrawal, rule: withdrawal = new ledger row)
 *   → whatsapp consent gate (DESIGN.md §10.2: explicit opt-in required)
 *   → session resume / start (greeting) → one engine turn → reply via adapter
 *
 * No user content is ever logged (rule 8) — only ids and statuses.
 */
import { Inject, Injectable } from '@nestjs/common';
import { FieldCrypto } from '@saath/crypto';
import { createLogger } from '@saath/logger';
import type { AppConfig } from '../../../config';
import { PrismaService } from '../../../prisma/prisma.service';
import { APP_CONFIG } from '../../identity/tokens';
import { ConsentService } from '../../consent/consent.service';
import { OnboardingService } from '../../onboarding/onboarding.service';
import type { ChannelAdapter } from '../channel.types';
import { WHATSAPP_ADAPTER } from './tokens';
import { confirmNudge, detectLocale, optOutAck } from './channel-messages';
import type { WhatsAppWebhookDto } from './whatsapp.dto';

const logger = createLogger('whatsapp-channel');

@Injectable()
export class WhatsAppService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
    @Inject(ConsentService) private readonly consents: ConsentService,
    @Inject(FieldCrypto) private readonly crypto: FieldCrypto,
    @Inject(WHATSAPP_ADAPTER) private readonly adapter: ChannelAdapter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async handleInbound(dto: WhatsAppWebhookDto): Promise<void> {
    for (const entry of dto.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;
        for (const msg of change.value.messages ?? []) {
          if (msg.type !== 'text' || !msg.text) continue; // non-text inbound: P2 scope
          try {
            await this.handleMessage(msg.from, msg.id, msg.text.body);
          } catch (err) {
            // One bad message must not drop the whole batch; Meta retries are
            // deduped by the wamid idempotency check on redelivery.
            logger.error({ err, messageId: msg.id }, 'whatsapp message handling failed');
          }
        }
      }
    }
  }

  private async handleMessage(from: string, messageId: string, body: string): Promise<void> {
    // Idempotency (rule 12): first writer wins; replays are ignored.
    const already = await this.prisma.webhookEvent.findUnique({ where: { id: messageId } });
    if (already) return;
    try {
      await this.prisma.webhookEvent.create({ data: { id: messageId, source: 'whatsapp' } });
    } catch {
      return; // concurrent delivery of the same event
    }

    const phoneE164 = from.startsWith('+') ? from : `+${from}`;
    const phoneHash = await this.crypto.hashLookup(phoneE164);
    // Pre-auth lookup runs in the channels service context (RLS service policy).
    const user = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'channels', true)`;
      return tx.user.findUnique({ where: { phoneHash } });
    });
    if (!user) {
      logger.info({ messageId }, 'whatsapp inbound from unknown number ignored');
      return;
    }

    const text = body.trim();
    const locale = detectLocale(text, user.locale);

    if (this.isOptOut(text)) {
      await this.consents.record(user.id, 'whatsapp', false, 'whatsapp');
      await this.adapter.sendText(phoneE164, optOutAck(locale));
      logger.info({ userId: user.id }, 'whatsapp opt-out recorded');
      return;
    }

    // Explicit opt-in required (DESIGN.md §10.2): no consent → no messages.
    const consent = (await this.consents.latest(user.id)).find((c) => c.purpose === 'whatsapp');
    if (!consent?.granted) {
      logger.info({ userId: user.id }, 'whatsapp consent not granted — not replying');
      return;
    }

    const session = await this.onboarding.latest(user.id);
    if (!session) {
      const started = await this.onboarding.start(user.id, { locale });
      await this.adapter.sendText(phoneE164, started.message);
      const turn = await this.onboarding.takeTurn(user.id, started.sessionId, { text });
      await this.adapter.sendText(phoneE164, turn.replyText);
      return;
    }
    if (session.status === 'in_progress') {
      const turn = await this.onboarding.takeTurn(user.id, session.id, { text });
      await this.adapter.sendText(phoneE164, turn.replyText);
      return;
    }
    if (session.status === 'awaiting_confirm') {
      await this.adapter.sendText(phoneE164, confirmNudge(locale));
    }
    // 'confirmed': profile is live, nothing to do.
  }

  private isOptOut(text: string): boolean {
    const normalized = text.toLowerCase();
    return this.config.WHATSAPP_OPTOUT_KEYWORDS.split(',')
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length > 0)
      .some((k) => normalized === k);
  }
}
