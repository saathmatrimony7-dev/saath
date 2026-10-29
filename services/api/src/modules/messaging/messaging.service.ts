/**
 * Messaging (P4-01…P4-04, DESIGN.md §9 messaging + §10.2 + §14): mutual-match
 * chat with C4-encrypted bodies, pre-send contact masking, blocked-pair
 * gating, server-side paywall (message cap + intro credits + calls), masked
 * calls through the provider bridge, and A8 coordinator state.
 *
 * All data access runs in the 'messaging' service context (RLS); owner
 * reads go through withUser. Chat plaintext exists only transiently: it is
 * encrypted before the DB write and the pre-send mask scan runs on the
 * plaintext in-memory only (deterministic — no LLM on the send path).
 *
 * Privacy invariants:
 * - a conversation is participant-only (RLS) and 404 for anyone else —
 *   including its existence (no-existence-leak convention);
 * - contact details (phone/email/links/handles) are rejected pre-send
 *   until BOTH users opt in to share contacts (exit criterion 3);
 * - call flows expose only provider refs — numbers are never stored.
 */
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createLogger } from '@saath/logger';
import { FieldCrypto } from '@saath/crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { RlsTransaction } from '../../prisma/rls-prisma.client';
import type { AppConfig } from '../../config';
import { APP_CONFIG } from '../identity/tokens';
import { MODERATION_AGENT } from '../safety/moderation-agent.tokens';
import type { ModerationAgentClient } from '../safety/moderation-agent';
import { EntitlementsService } from '../billing/entitlements.service';
import { NotificationsService } from '../notifications/notifications.service';
import { scanForContactDetails } from './contact-mask';
import type { CallBridge } from './call-provider';
import { CALL_PROVIDER } from './tokens';

const logger = createLogger('messaging');

export interface ConversationView {
  id: string;
  participantIds: [string, string];
  origin: string;
  status: string;
  openedAt: Date;
  contactShared: boolean;
  proposedSlots: unknown;
  lastMessageAt: Date | null;
}

export interface MessageView {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  moderationStatus: string;
  createdAt: Date;
}

@Injectable()
export class MessagingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FieldCrypto) private readonly crypto: FieldCrypto,
    @Inject(MODERATION_AGENT) private readonly moderation: ModerationAgentClient,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(CALL_PROVIDER) private readonly calls: CallBridge,
  ) {}

  /** Canonical pair ordering enforced at every entry point. */
  private pair(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a];
  }

  private async inService<T>(fn: (tx: RlsTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.service', 'messaging', true)`;
      return fn(tx as RlsTransaction);
    });
  }

  /** Participant-only conversation lookup; 404 leaks nothing to outsiders. */
  private async getParticipantConversation(
    tx: RlsTransaction,
    userId: string,
    conversationId: string,
  ) {
    const conv = await tx.conversation.findUnique({ where: { id: conversationId } });
    if (!conv || (conv.userA !== userId && conv.userB !== userId)) {
      throw new NotFoundException('conversation not found');
    }
    return conv;
  }

  private conversationView(c: {
    id: string;
    userA: string;
    userB: string;
    origin: string;
    status: string;
    openedAt: Date;
    contactSharedAt: Date | null;
    proposedSlots: Prisma.JsonValue;
    lastMessageAt: Date | null;
  }): ConversationView {
    return {
      id: c.id,
      participantIds: [c.userA, c.userB],
      origin: c.origin,
      status: c.status,
      openedAt: c.openedAt,
      contactShared: c.contactSharedAt !== null,
      proposedSlots: c.proposedSlots,
      lastMessageAt: c.lastMessageAt,
    };
  }

  // ---- Conversation lifecycle ----------------------------------------------

  /**
   * Opens (or returns) the conversation for a mutual match. Called by the
   * interactions module when a like completes a mutual pair (P4-03).
   * Notifies both participants (match.mutual).
   */
  async openForMutual(aId: string, bId: string): Promise<ConversationView> {
    if (aId === bId) throw new ForbiddenException('cannot converse with yourself');
    const [userA, userB] = this.pair(aId, bId);
    return this.inService(async (tx) => {
      const existing = await tx.conversation.findUnique({
        where: { userA_userB: { userA, userB } },
      });
      if (existing) return this.conversationView(existing);
      const created = await tx.conversation.create({
        data: { userA, userB, origin: 'mutual' },
      });
      for (const uid of [userA, userB]) {
        await this.notifications.notifyInTx(tx, uid, 'match.mutual', { conversationId: created.id });
      }
      logger.info({ userA, userB }, 'conversation opened (mutual)');
      return this.conversationView(created);
    });
  }

  /**
   * Opens (or returns) a conversation with a not-yet-mutual candidate by
   * spending one intro-pack credit (P4-06). The paywall is authoritative:
   * no credit → 403 PAYWALL, no conversation.
   */
  async openIntro(userId: string, candidateId: string): Promise<ConversationView> {
    if (userId === candidateId) throw new ForbiddenException('cannot converse with yourself');
    const [userA, userB] = this.pair(userId, candidateId);
    return this.inService(async (tx) => {
      const existing = await tx.conversation.findUnique({
        where: { userA_userB: { userA, userB } },
      });
      if (existing) return this.conversationView(existing);
      await this.entitlements.consumeIntroCreditInTx(tx, userId);
      const created = await tx.conversation.create({
        data: { userA, userB, origin: 'intro' },
      });
      logger.info({ userId, candidateId }, 'conversation opened (intro credit)');
      return this.conversationView(created);
    });
  }

  async listConversations(userId: string): Promise<ConversationView[]> {
    return this.inService(async (tx) => {
      const rows = await tx.conversation.findMany({
        where: { OR: [{ userA: userId }, { userB: userId }] },
        orderBy: [{ lastMessageAt: 'desc' }, { openedAt: 'desc' }],
        take: 100,
      });
      return rows.map((c) => this.conversationView(c));
    });
  }

  async getConversation(userId: string, conversationId: string): Promise<ConversationView> {
    return this.inService(async (tx) =>
      this.conversationView(await this.getParticipantConversation(tx, userId, conversationId)),
    );
  }

  // ---- Messages --------------------------------------------------------------

  private async decryptBody(enc: Uint8Array | null): Promise<string> {
    if (!enc) return '';
    return this.crypto.decrypt(Buffer.from(enc));
  }

  /**
   * Sends a message. Order of gates (each failure is a distinct, testable
   * contract): participant 404 → conversation open → blocked pair 403 →
   * paywall (plan message cap) 403 → contact mask 422 (unless both opted
   * in) → persist (idempotent per clientRef) → A9 classify → notify.
   */
  async sendMessage(
    userId: string,
    conversationId: string,
    body: string,
    clientRef?: string,
  ): Promise<MessageView> {
    if (body.length === 0 || body.length > this.config.CHAT_MAX_MESSAGE_CHARS) {
      throw new ForbiddenException('invalid message length');
    }
    const scan = scanForContactDetails(body);

    return this.inService(async (tx) => {
      const conv = await this.getParticipantConversation(tx, userId, conversationId);
      if (conv.status !== 'open') throw new ForbiddenException('conversation is closed');

      const blocked = await tx.$queryRaw<[{ n: number }]>`
        SELECT count(*)::int AS n FROM "blocks"
         WHERE ("blocker_id" = ${conv.userA}::uuid AND "blocked_id" = ${conv.userB}::uuid)
            OR ("blocker_id" = ${conv.userB}::uuid AND "blocked_id" = ${conv.userA}::uuid)`;
      if (blocked[0]?.n) {
        throw new ForbiddenException('conversation is blocked');
      }

      // Paywall: daily message cap from the entitlement authority (P4 exit
      // criterion 2 — enforced server-side, never client-side).
      const effective = await this.entitlements.effectiveInTx(tx, userId);
      if (!effective.chat) throw new ForbiddenException({ message: 'chat not available', code: 'PAYWALL' });
      if (effective.dailyMessageLimit !== -1) {
        const dayStart = new Date();
        dayStart.setUTCHours(0, 0, 0, 0);
        const sentToday = await tx.message.count({
          where: { senderId: userId, createdAt: { gte: dayStart } },
        });
        if (sentToday >= effective.dailyMessageLimit) {
          throw new ForbiddenException({
            message: 'daily message limit reached',
            code: 'PAYWALL',
          });
        }
      }

      if (scan.blocked && !conv.contactSharedAt) {
        throw new ConflictException({
          message: 'contact details are masked until both users opt in',
          code: 'CONTACT_MASKED',
          reasons: scan.reasons,
        });
      }

      // Idempotency (§11): same (sender, clientRef) returns the original.
      if (clientRef) {
        const existing = await tx.message.findUnique({
          where: { senderId_clientRef: { senderId: userId, clientRef } },
        });
        if (existing) return this.messageView(existing, body);
      }

      const bodyEnc = Buffer.from(await this.crypto.encrypt(body));
      const message = await tx.message.create({
        data: { conversationId, senderId: userId, bodyEnc, clientRef: clientRef ?? null },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: message.createdAt },
      });

      // A9 classification at the moderation-agent boundary (mock = safe;
      // scripted in tests). A flagged message is still delivered — flags
      // feed the safety pipeline, they are not a silent drop.
      const verdict = await this.moderation.classify(body);
      const moderationStatus = verdict.label === 'safe' ? 'clean' : 'flagged';
      await tx.message.update({
        where: { id: message.id },
        data: { moderationStatus },
      });

      const recipientId = conv.userA === userId ? conv.userB : conv.userA;
      await this.notifications.notifyInTx(tx, recipientId, 'message.received', {
        conversationId,
        messageId: message.id,
      });
      return this.messageView({ ...message, moderationStatus }, body);
    });
  }

  async listMessages(
    userId: string,
    conversationId: string,
    limit = 50,
  ): Promise<MessageView[]> {
    return this.inService(async (tx) => {
      await this.getParticipantConversation(tx, userId, conversationId);
      const rows = await tx.message.findMany({
        where: { conversationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: Math.min(limit, 100),
      });
      const reversed = rows.reverse();
      const bodies = await Promise.all(reversed.map((m) => this.decryptBody(m.bodyEnc)));
      return reversed.map((m, i) => this.messageView(m, bodies[i]!));
    });
  }

  private messageView(
    m: {
      id: string;
      conversationId: string;
      senderId: string;
      bodyEnc: Uint8Array;
      moderationStatus: string;
      createdAt: Date;
    },
    decryptedBody: string,
  ): MessageView {
    return {
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      body: decryptedBody,
      moderationStatus: m.moderationStatus,
      createdAt: m.createdAt,
    };
  }

  /**
   * One-sided contact-sharing opt-in (§10.2). When BOTH sides have opted
   * in, contact details unblock (contact_shared_at is the gate the send
   * path checks). Idempotent.
   */
  async shareContact(userId: string, conversationId: string): Promise<{ contactShared: boolean }> {
    return this.inService(async (tx) => {
      const conv = await this.getParticipantConversation(tx, userId, conversationId);
      if (conv.contactSharedAt) return { contactShared: true };
      const field = conv.userA === userId ? 'contactShareA' : 'contactShareB';
      await tx.conversation.update({ where: { id: conv.id }, data: { [field]: true } });
      const refreshed = await tx.conversation.findUniqueOrThrow({ where: { id: conv.id } });
      if (refreshed.contactShareA && refreshed.contactShareB && !refreshed.contactSharedAt) {
        await tx.conversation.update({
          where: { id: conv.id },
          data: { contactSharedAt: new Date() },
        });
        return { contactShared: true };
      }
      return { contactShared: false };
    });
  }

  // ---- Masked calls (P4-04) ---------------------------------------------------

  /**
   * Initiates a masked call. Paywall: the 'calls' entitlement (paid plans)
   * is required — enforced here, server-side (P4 exit criterion 2).
   */
  async startCall(userId: string, conversationId: string) {
    return this.inService(async (tx) => {
      const conv = await this.getParticipantConversation(tx, userId, conversationId);
      if (conv.status !== 'open') throw new ForbiddenException('conversation is closed');
      const effective = await this.entitlements.effectiveInTx(tx, userId);
      if (!effective.calls) {
        throw new ForbiddenException({
          message: 'masked calls require a paid plan',
          code: 'PAYWALL',
        });
      }
      const { providerRef } = await this.calls.initiate(conversationId);
      const call = await tx.callSession.create({
        data: { conversationId, initiatedBy: userId, providerRef, status: 'initiated' },
      });
      return {
        id: call.id,
        conversationId: call.conversationId,
        providerRef: call.providerRef,
        status: call.status,
      };
    });
  }

  /** Ends a call (initiator or the other participant). Duration is provider-agnostic. */
  async endCall(
    userId: string,
    conversationId: string,
    callId: string,
    outcome: { status: 'completed' | 'failed' | 'declined'; durationSec?: number },
  ) {
    return this.inService(async (tx) => {
      await this.getParticipantConversation(tx, userId, conversationId);
      const call = await tx.callSession.findUnique({ where: { id: callId } });
      if (!call || call.conversationId !== conversationId) {
        throw new NotFoundException('call not found');
      }
      if (call.endedAt) return { id: call.id, status: call.status, durationSec: call.durationSec };
      const durationSec =
        outcome.durationSec !== undefined
          ? Math.max(0, Math.min(outcome.durationSec, 86_400))
          : null;
      const updated = await tx.callSession.update({
        where: { id: call.id },
        data: {
          status: outcome.status,
          startedAt: call.startedAt ?? call.createdAt,
          endedAt: new Date(),
          durationSec,
        },
      });
      return { id: updated.id, status: updated.status, durationSec: updated.durationSec };
    });
  }

  async listCalls(userId: string, conversationId: string) {
    return this.inService(async (tx) => {
      await this.getParticipantConversation(tx, userId, conversationId);
      const rows = await tx.callSession.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return rows.map((c) => ({
        id: c.id,
        initiatedBy: c.initiatedBy,
        providerRef: c.providerRef,
        status: c.status,
        durationSec: c.durationSec,
        createdAt: c.createdAt,
      }));
    });
  }

  // ---- A8 coordinator state (P4-09) -------------------------------------------

  /** propose_slots tool backing: stores the slot proposal on the conversation. */
  async proposeSlots(userId: string, conversationId: string, slots: string[]) {
    if (slots.length === 0 || slots.length > 5) {
      throw new ForbiddenException('between 1 and 5 slots');
    }
    for (const s of slots) {
      if (Number.isNaN(Date.parse(s))) throw new ForbiddenException('slots must be ISO datetimes');
    }
    return this.inService(async (tx) => {
      await this.getParticipantConversation(tx, userId, conversationId);
      await tx.conversation.update({
        where: { id: conversationId },
        data: { proposedSlots: slots },
      });
      await this.notifications.notifyInTx(tx, userId, 'coordinator.suggestion', {
        conversationId,
        kind: 'slots',
        count: slots.length,
      });
      return { proposed: slots.length };
    });
  }

  /** send_nudge tool backing: a reminder notification to the CALLER's own user only. */
  async sendNudge(userId: string, conversationId: string) {
    return this.inService(async (tx) => {
      await this.getParticipantConversation(tx, userId, conversationId);
      const result = await this.notifications.notifyInTx(tx, userId, 'coordinator.suggestion', {
        conversationId,
        kind: 'nudge',
      });
      return { delivered: result.delivered, reason: result.reason ?? null };
    });
  }

  /** record_meeting_feedback tool backing: C4-encrypted notes on the conversation. */
  async recordMeetingFeedback(
    userId: string,
    conversationId: string,
    outcome: 'went_well' | 'neutral' | 'did_not_meet' | 'not_a_match',
    notes?: string,
  ) {
    return this.inService(async (tx) => {
      await this.getParticipantConversation(tx, userId, conversationId);
      const notesEnc = notes ? (await this.crypto.encrypt(notes)).toString('base64') : null;
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          meetingFeedback: { outcome, notesEnc, recordedBy: userId, at: new Date().toISOString() },
        },
      });
      return { recorded: true };
    });
  }
}
