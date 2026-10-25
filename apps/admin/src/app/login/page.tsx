'use client';

import { useState } from 'react';

import { apiPost } from '@/lib/api';

export default function AdminLoginPage() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestOtp() {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/auth/otp/request', { phone });
      setStep('code');
    } catch {
      setError('Could not send the code. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/auth/otp/verify', { phone, code });
      window.location.assign('/dashboard');
    } catch {
      setError('Verification failed. Check the code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-2xl font-bold">Saath admin console</h1>
      <p className="text-center text-sm text-slate-600">
        Staff access only. Every view and action here is audited.
      </p>
      <form
        className="flex w-full flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void (step === 'phone' ? requestOtp() : verify());
        }}
      >
        {step === 'phone' ? (
          <label className="flex flex-col gap-1">
            <span className="font-medium">Staff phone</span>
            <input
              type="tel"
              inputMode="numeric"
              required
              minLength={10}
              maxLength={16}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="10-digit mobile number"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-800"
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="font-medium">OTP code</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              pattern="[0-9]{6}"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6-digit code"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 tracking-widest focus:outline-none focus:ring-2 focus:ring-slate-800"
            />
          </label>
        )}
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-800 disabled:opacity-60"
        >
          {step === 'phone' ? 'Send OTP' : 'Verify'}
        </button>
      </form>
    </main>
  );
}
