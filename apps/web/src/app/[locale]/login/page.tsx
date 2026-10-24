'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { LanguageSwitcher } from '@/components/language-switcher';
import { ApiError, apiPost } from '@/lib/api';

export default function LoginPage() {
  const t = useTranslations();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function requestOtp() {
    setBusy(true);
    setErrorKey(null);
    try {
      await apiPost('/auth/otp/request', { phone });
      setStep('code');
    } catch (err) {
      setErrorKey(mapError(err, 'auth.errorGeneric'));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setErrorKey(null);
    try {
      await apiPost('/auth/otp/verify', { phone, code });
      // Onboarding is locale-aware; the interview session carries the locale.
      window.location.assign(`${window.location.pathname.replace('/login', '')}/onboarding`);
    } catch (err) {
      setErrorKey(mapError(err, 'auth.errorInvalidCode'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
      <h1 className="text-3xl font-bold">{t('auth.title')}</h1>
      <p className="text-center text-stone-600">{t('auth.subtitle')}</p>
      <form
        className="flex w-full flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void (step === 'phone' ? requestOtp() : verify());
        }}
      >
        {step === 'phone' ? (
          <label className="flex flex-col gap-1">
            <span className="font-medium">{t('auth.phoneLabel')}</span>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              required
              minLength={10}
              maxLength={16}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t('auth.phonePlaceholder')}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-stone-800"
            />
          </label>
        ) : (
          <>
            <p role="status" className="text-sm text-green-800">
              {t('auth.otpSent')}
            </p>
            <label className="flex flex-col gap-1">
              <span className="font-medium">{t('auth.codeLabel')}</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                pattern="[0-9]{6}"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t('auth.codePlaceholder')}
                className="rounded-lg border border-stone-300 bg-white px-3 py-2 tracking-widest focus:outline-none focus:ring-2 focus:ring-stone-800"
              />
            </label>
          </>
        )}
        {errorKey ? (
          <p role="alert" className="text-sm text-red-700">
            {t(errorKey)}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-stone-900 px-4 py-2 font-semibold text-amber-50 hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-800 focus:ring-offset-2 disabled:opacity-60"
        >
          {step === 'phone' ? t('auth.sendOtp') : t('auth.verify')}
        </button>
      </form>
    </main>
  );
}

function mapError(err: unknown, fallbackKey: string): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'auth.errorInvalidCode';
    if (err.status === 429) return 'auth.errorRateLimit';
  }
  return fallbackKey;
}
