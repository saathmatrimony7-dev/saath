'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';

import { apiGet, apiPost, ApiError } from '@/lib/api';

interface Invite {
  inviteId: string;
  ownerId: string;
  memberId: string | null;
  relation: string;
  permissions: { view: boolean; comment: boolean };
  status: string;
  expiresAt: string;
  acceptedAt: string | null;
  amMember: boolean;
}

interface Card {
  interactionId: string;
  candidateId: string;
  shortlistedAt: string;
  age: number | null;
  city: { id: string; labels: Record<string, string> } | null;
  diet: string | null;
  maritalStatus: string | null;
  heightCm: number | null;
  verificationTier: number;
  religion?: { id: string; labels: Record<string, string> } | null;
  community?: { id: string; labels: Record<string, string> } | null;
  photo?: { id: string; url: string } | null;
}

interface FeedbackRow {
  id: string;
  candidateId: string;
  familyMemberId: string;
  signal: string;
  comment: string | null;
  createdAt: string;
}

const RELATIONS = ['parent', 'sibling', 'child', 'guardian', 'other'] as const;
const SIGNALS = ['approve', 'reject', 'interested', 'concern'] as const;

function label(locales: Record<string, string> | undefined, locale: string): string {
  if (!locales) return '';
  return locales[locale] ?? locales.en ?? Object.values(locales)[0] ?? '';
}

function FamilyInner() {
  const t = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const acceptToken = searchParams.get('token');

  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [relation, setRelation] = useState<string>('parent');
  const [commentAllowed, setCommentAllowed] = useState(true);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [acceptState, setAcceptState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  const membership = invites?.find((i) => i.amMember && i.status === 'accepted') ?? null;
  const isMember = membership !== null;

  const load = useCallback(async () => {
    try {
      const list = await apiGet<Invite[]>('/family/invites');
      setInvites(list);
      const active = list.find((i) => i.amMember && i.status === 'accepted');
      if (active) {
        const oid = active.ownerId;
        setOwnerId(oid);
        const [view, digest, rows] = await Promise.all([
          apiGet<{ cards: Card[] }>(`/family/shortlist?ownerId=${oid}`),
          apiGet<{ summary: string }>(`/family/summary?ownerId=${oid}`),
          apiGet<{ rows: FeedbackRow[] }>(`/family/feedback?ownerId=${oid}`),
        ]);
        setCards(view.cards);
        setSummary(digest.summary);
        setFeedback(rows.rows);
      } else {
        setCards(null);
        setSummary(null);
        setFeedback([]);
      }
      setErrorKey(null);
    } catch (err) {
      setErrorKey(
        err instanceof ApiError && err.status === 403
          ? 'family.consentRequired'
          : 'family.loadError',
      );
      setInvites([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createInvite() {
    setCreatedToken(null);
    try {
      const res = await apiPost<{ token: string }>('/family/invites', {
        relation,
        permissions: { view: true, comment: commentAllowed },
      });
      setCreatedToken(res.token);
      await load();
    } catch {
      setErrorKey('family.loadError');
    }
  }

  async function acceptInvite() {
    if (!acceptToken) return;
    setAcceptState('busy');
    try {
      await apiPost('/family/invites/accept', { token: acceptToken });
      setAcceptState('done');
      await load();
    } catch {
      setAcceptState('error');
    }
  }

  async function sendFeedback(candidateId: string, signal: string) {
    if (!ownerId) return;
    try {
      await apiPost('/family/feedback', {
        ownerId,
        candidateId,
        signal,
        comment: drafts[candidateId]?.trim() ? drafts[candidateId]!.trim() : undefined,
      });
      const rows = await apiGet<{ rows: FeedbackRow[] }>(`/family/feedback?ownerId=${ownerId}`);
      setFeedback(rows.rows);
      setDrafts((d) => ({ ...d, [candidateId]: '' }));
    } catch (err) {
      setErrorKey(
        err instanceof ApiError && err.status === 403
          ? 'family.commentNotAllowed'
          : 'family.loadError',
      );
    }
  }

  const signalsFor = (candidateId: string) =>
    feedback
      .filter((f) => f.candidateId === candidateId)
      .map((f) => t(`family.signal.${f.signal}`));

  return (
    <div className="w-full space-y-6">
      {acceptToken && acceptState !== 'done' ? (
        <section className="rounded-lg border border-stone-300 bg-white p-4">
          <h2 className="font-semibold">{t('family.acceptTitle')}</h2>
          <p className="mt-1 text-stone-700">{t('family.acceptBody')}</p>
          {acceptState === 'error' ? (
            <p role="alert" className="mt-2 text-red-700">
              {t('family.acceptError')}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void acceptInvite()}
            disabled={acceptState === 'busy'}
            className="mt-3 rounded-lg bg-green-800 px-4 py-2 font-semibold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-800 focus:ring-offset-2 disabled:opacity-60"
          >
            {acceptState === 'busy' ? t('common.loading') : t('family.acceptButton')}
          </button>
        </section>
      ) : null}

      {errorKey ? (
        <p role="alert" className="text-red-700">
          {t(errorKey)}
        </p>
      ) : null}

      {invites === null ? <p className="text-stone-600">{t('common.loading')}</p> : null}

      {!isMember && invites !== null ? (
        <section className="rounded-lg border border-stone-300 bg-white p-4">
          <h2 className="font-semibold">{t('family.ownerTitle')}</h2>
          {invites.length === 0 ? (
            <p className="mt-2 text-stone-700">{t('family.empty')}</p>
          ) : (
            <ul className="mt-2 space-y-1 text-stone-700">
              {invites.map((i) => (
                <li key={i.inviteId}>
                  {t(`family.relation.${i.relation}`)} · {t(`family.status.${i.status}`)}
                  {i.permissions.comment ? '' : ` · ${t('family.noComment')}`}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <select
              aria-label={t('family.relationLabel')}
              value={relation}
              onChange={(e) => setRelation(e.target.value)}
              className="rounded-lg border border-stone-300 px-3 py-2"
            >
              {RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {t(`family.relation.${r}`)}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-stone-700">
              <input
                type="checkbox"
                checked={commentAllowed}
                onChange={(e) => setCommentAllowed(e.target.checked)}
              />
              {t('family.commentAllowed')}
            </label>
            <button
              type="button"
              onClick={() => void createInvite()}
              className="rounded-lg bg-stone-900 px-4 py-2 font-semibold text-amber-50 hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-900 focus:ring-offset-2"
            >
              {t('family.createButton')}
            </button>
          </div>
          {createdToken ? (
            <p className="mt-3 break-all rounded-lg bg-amber-50 p-3 text-sm text-stone-800">
              {t('family.tokenHint')} <code>{createdToken}</code>
            </p>
          ) : null}
        </section>
      ) : null}

      {isMember ? (
        <section className="space-y-4">
          {summary ? (
            <div className="rounded-lg border border-stone-300 bg-white p-4">
              <h2 className="font-semibold">{t('family.summaryLabel')}</h2>
              <p className="mt-2 text-stone-700">{summary}</p>
            </div>
          ) : null}

          <h2 className="text-lg font-semibold">{t('family.memberTitle')}</h2>
          {cards === null ? <p className="text-stone-600">{t('common.loading')}</p> : null}
          {cards !== null && cards.length === 0 ? (
            <p className="text-stone-700">{t('family.shortlistEmpty')}</p>
          ) : null}
          {cards?.map((c) => (
            <article
              key={c.interactionId}
              className="rounded-lg border border-stone-300 bg-white p-4"
            >
              <div className="flex items-start gap-4">
                {c.photo ? (
                  <img src={c.photo.url} alt="" className="h-20 w-20 rounded-lg object-cover" />
                ) : null}
                <div className="text-stone-800">
                  <p>
                    {c.age !== null ? t('family.cardAge', { age: c.age }) : null}
                    {c.city ? ` · ${label(c.city.labels, locale)}` : ''}
                    {c.diet ? ` · ${c.diet}` : ''}
                  </p>
                  {c.community ? (
                    <p className="text-sm text-stone-600">{label(c.community.labels, locale)}</p>
                  ) : null}
                  {c.religion ? (
                    <p className="text-sm text-stone-600">{label(c.religion.labels, locale)}</p>
                  ) : null}
                  {signalsFor(c.candidateId).length > 0 ? (
                    <p className="mt-1 text-sm text-stone-600">
                      {t('family.signalsSoFar')}: {signalsFor(c.candidateId).join(', ')}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {SIGNALS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void sendFeedback(c.candidateId, s)}
                    className="rounded-lg border border-stone-400 px-3 py-1 text-sm font-semibold text-stone-800 hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-900 focus:ring-offset-2"
                  >
                    {t(`family.signal.${s}`)}
                  </button>
                ))}
                <input
                  type="text"
                  value={drafts[c.candidateId] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [c.candidateId]: e.target.value }))}
                  placeholder={t('family.commentPlaceholder')}
                  className="min-w-40 flex-1 rounded-lg border border-stone-300 px-3 py-1 text-sm"
                />
              </div>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}

export default function FamilyPage() {
  return (
    <Suspense fallback={null}>
      <FamilyInner />
    </Suspense>
  );
}
