'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { LanguageSwitcher } from '@/components/language-switcher';
import { apiPost, postTurnStream } from '@/lib/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

const AI_PREFIX = '[AI] ';

/** Strips the engine's [AI] label — the UI renders its own badge instead. */
function stripAiLabel(text: string): string {
  return text.startsWith(AI_PREFIX) ? text.slice(AI_PREFIX.length) : text;
}

export default function OnboardingPage() {
  const t = useTranslations();
  const locale = useLocale();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'in_progress' | 'awaiting_confirm' | 'error'>(
    'loading',
  );
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [turnFailed, setTurnFailed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await apiPost<{ sessionId: string; status: string; message: string }>(
          '/onboarding/sessions',
          { locale },
        );
        if (cancelled) return;
        setSessionId(session.sessionId);
        setMessages([{ role: 'assistant', text: stripAiLabel(session.message) }]);
        setStatus(session.status === 'awaiting_confirm' ? 'awaiting_confirm' : 'in_progress');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  async function send() {
    const text = input.trim();
    if (!text || !sessionId || busy) return;
    setInput('');
    setBusy(true);
    setMessages((prev) => [...prev, { role: 'user', text }]);
    // Stream the reply word-by-word into the pending assistant bubble.
    setMessages((prev) => [...prev, { role: 'assistant', text: '' }]);
    try {
      const result = await postTurnStream(sessionId, text, (delta) => {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'assistant')
            next[next.length - 1] = { role: 'assistant', text: last.text + delta };
          return next;
        });
      });
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant') {
          next[next.length - 1] = { role: 'assistant', text: stripAiLabel(result.reply) };
        }
        return next;
      });
      if (result.status === 'awaiting_confirm') setStatus('awaiting_confirm');
    } catch {
      // Drop the empty bubble and surface an i18n error.
      setMessages((prev) =>
        prev.filter((m, i) => !(i === prev.length - 1 && m.role === 'assistant' && m.text === '')),
      );
      setTurnFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{t('onboarding.title')}</h1>
        <LanguageSwitcher />
      </div>
      <div className="mt-4 flex flex-1 flex-col gap-3 overflow-y-auto" aria-live="polite">
        {status === 'loading' ? <p className="text-stone-600">{t('common.loading')}</p> : null}
        {status === 'error' ? (
          <p role="alert" className="text-red-700">
            {t('onboarding.sessionError')}
          </p>
        ) : null}
        {messages.map((m, i) => (
          <div
            key={i}
            data-testid="chat-message"
            className={m.role === 'user' ? 'self-end' : 'self-start'}
          >
            <span
              className={
                m.role === 'assistant'
                  ? 'mr-2 rounded bg-stone-900 px-2 py-0.5 text-xs font-semibold text-amber-50'
                  : 'mr-2 rounded bg-stone-300 px-2 py-0.5 text-xs font-semibold text-stone-900'
              }
            >
              {m.role === 'assistant' ? t('onboarding.aiBadge') : t('onboarding.youBadge')}
            </span>
            <span className="whitespace-pre-wrap">{m.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {status === 'awaiting_confirm' ? (
        <div className="mt-4 rounded-lg border border-green-700 bg-green-50 p-4">
          <p className="font-medium">{t('onboarding.awaitingConfirmTitle')}</p>
          <a
            href={`/${locale}/profile/review?sessionId=${sessionId ?? ''}`}
            className="mt-2 inline-block rounded-lg bg-green-800 px-4 py-2 font-semibold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-800 focus:ring-offset-2"
          >
            {t('onboarding.reviewLink')}
          </a>
        </div>
      ) : (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label htmlFor="chat-input" className="sr-only">
            {t('onboarding.inputPlaceholder')}
          </label>
          <input
            id="chat-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('onboarding.inputPlaceholder')}
            disabled={busy || status !== 'in_progress'}
            className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-stone-800"
          />
          <button
            type="submit"
            disabled={busy || status !== 'in_progress' || !input.trim()}
            className="rounded-lg bg-stone-900 px-4 py-2 font-semibold text-amber-50 hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-800 focus:ring-offset-2 disabled:opacity-60"
          >
            {t('onboarding.send')}
          </button>
        </form>
      )}
      {turnFailed ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {t('onboarding.turnError')}
        </p>
      ) : null}
    </main>
  );
}
