'use client';

import { Suspense, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { apiGet, apiPost } from '@/lib/api';

interface Transcript {
  messages: { role: 'user' | 'assistant'; content: string }[];
}

type Phase = 'loading' | 'ready' | 'confirming' | 'confirmed' | 'error';

function ReviewInner({ sessionId }: { sessionId: string }) {
  const t = useTranslations();
  const [phase, setPhase] = useState<Phase>('loading');
  const [summary, setSummary] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const transcript = await apiGet<Transcript>(`/onboarding/sessions/${sessionId}`);
        if (cancelled) return;
        const lastAssistant = [...transcript.messages]
          .reverse()
          .find((m) => m.role === 'assistant');
        setSummary(lastAssistant?.content.replace(/^\[AI\] /, '') ?? null);
        setPhase('ready');
      } catch {
        if (!cancelled) {
          setErrorKey('profile.transcriptError');
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function confirm() {
    setPhase('confirming');
    setErrorKey(null);
    try {
      await apiPost('/onboarding/confirm', { sessionId, confirmed: true });
      setPhase('confirmed');
    } catch {
      setErrorKey('profile.confirmError');
      setPhase('ready');
    }
  }

  if (phase === 'confirmed') {
    return (
      <div className="w-full rounded-lg border border-green-700 bg-green-50 p-6 text-center">
        <h2 className="text-xl font-bold">{t('profile.confirmedTitle')}</h2>
        <p className="mt-2 text-stone-700">{t('profile.confirmedBody')}</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      {phase === 'loading' ? <p className="text-stone-600">{t('common.loading')}</p> : null}
      {phase === 'error' && errorKey ? (
        <p role="alert" className="text-red-700">
          {t(errorKey)}
        </p>
      ) : null}
      {summary !== null && phase !== 'error' ? (
        <section className="rounded-lg border border-stone-300 bg-white p-4">
          <h2 className="font-semibold">{t('profile.summaryLabel')}</h2>
          <p className="mt-2 whitespace-pre-wrap text-stone-700">{summary}</p>
        </section>
      ) : null}
      {phase === 'ready' ? (
        <button
          type="button"
          onClick={() => void confirm()}
          className="mt-4 w-full rounded-lg bg-green-800 px-4 py-2 font-semibold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-800 focus:ring-offset-2"
        >
          {t('profile.confirmButton')}
        </button>
      ) : null}
      {phase === 'confirming' ? (
        <p className="mt-4 text-stone-600" role="status">
          {t('common.loading')}
        </p>
      ) : null}
    </div>
  );
}

export default function ReviewPage() {
  const t = useTranslations();
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    setSessionId(new URLSearchParams(window.location.search).get('sessionId'));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center gap-6 px-4 py-6">
      <h1 className="text-2xl font-bold">{t('profile.reviewTitle')}</h1>
      {sessionId ? (
        <Suspense fallback={<p className="text-stone-600">{t('common.loading')}</p>}>
          <ReviewInner sessionId={sessionId} />
        </Suspense>
      ) : (
        <p role="alert" className="text-red-700">
          {t('profile.transcriptError')}
        </p>
      )}
    </main>
  );
}
