'use client';

import { useCallback, useEffect, useState } from 'react';

import { apiGet, apiPost, ApiError } from '@/lib/api';

interface UserRow {
  id: string;
  role: string;
  status: string;
  locale: string;
  ageVerified: boolean;
  createdAt: string;
  verificationTier: number;
  displayName: string | null;
  phone: string;
}
interface CaseRow {
  id: string;
  subjectId: string;
  source: string;
  severity: string;
  status: string;
  createdAt: string;
}
interface AuditRow {
  id: string;
  actorId: string;
  action: string;
  subjectKind: string;
  subjectId: string | null;
  at: string;
}

type Tab = 'users' | 'cases' | 'audit';

export default function AdminDashboardPage() {
  const [tab, setTab] = useState<Tab>('cases');
  const [denied, setDenied] = useState(false);
  const [elevating, setElevating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [decisions, setDecisions] = useState<Record<string, string>>({});

  const load = useCallback(async (active: Tab) => {
    setMessage(null);
    try {
      if (active === 'users') setUsers(await apiGet<UserRow[]>('/admin/users'));
      if (active === 'cases') setCases(await apiGet<CaseRow[]>('/admin/cases?status=open'));
      if (active === 'audit') setAudit(await apiGet<AuditRow[]>('/admin/audit'));
      setDenied(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (err instanceof ApiError && err.status === 403) setDenied(true);
      else setMessage('Could not load. Try again.');
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  async function elevate() {
    setElevating(true);
    setMessage(null);
    try {
      await apiPost('/admin/jit/elevate', { reason: 'console session' });
      setDenied(false);
      setMessage('Elevated for 15 minutes.');
      await load(tab);
    } catch (err) {
      setMessage(
        err instanceof ApiError && err.status === 403
          ? 'Your account has no staff role — ask a superadmin.'
          : 'Elevation failed.',
      );
    } finally {
      setElevating(false);
    }
  }

  async function decide(caseId: string, status: 'resolved' | 'dismissed') {
    const decision = decisions[caseId]?.trim();
    if (!decision) {
      setMessage('Write a decision note first.');
      return;
    }
    await apiPost(`/admin/cases/${caseId}/decide`, { status, decision });
    setDecisions((d) => ({ ...d, [caseId]: '' }));
    await load('cases');
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Saath admin</h1>
        <div className="flex gap-2 text-sm">
          {(['cases', 'users', 'audit'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                tab === t
                  ? 'rounded-full bg-slate-900 px-3 py-1 font-semibold text-white'
                  : 'rounded-full border border-slate-300 px-3 py-1 hover:bg-slate-200'
              }
            >
              {t}
            </button>
          ))}
        </div>
      </header>

      {denied ? (
        <div className="rounded-lg border border-amber-500 bg-amber-50 p-4">
          <p className="font-medium">Admin access required</p>
          <p className="text-sm text-slate-700">
            Your session has no admin role or active elevation.
          </p>
          <button
            onClick={() => void elevate()}
            disabled={elevating}
            className="mt-2 rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {elevating ? 'Elevating…' : 'Request JIT elevation (15 min)'}
          </button>
        </div>
      ) : null}
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}

      {!denied && tab === 'cases' ? (
        <section className="flex flex-col gap-2">
          {cases.length === 0 ? <p className="text-slate-600">No open cases.</p> : null}
          {cases.map((c) => (
            <div key={c.id} className="rounded-lg border border-slate-300 bg-white p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs">{c.id.slice(0, 8)}…</span>
                <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold uppercase">
                  {c.severity}
                </span>
              </div>
              <p className="text-sm">
                subject <span className="font-mono">{c.subjectId.slice(0, 8)}…</span> · source{' '}
                {c.source} · opened {new Date(c.createdAt).toLocaleString()}
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  value={decisions[c.id] ?? ''}
                  onChange={(e) => setDecisions((d) => ({ ...d, [c.id]: e.target.value }))}
                  placeholder="Decision note (required)"
                  className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                />
                <button
                  onClick={() => void decide(c.id, 'resolved')}
                  className="rounded bg-green-700 px-3 py-1 text-sm font-semibold text-white"
                >
                  Resolve
                </button>
                <button
                  onClick={() => void decide(c.id, 'dismissed')}
                  className="rounded bg-slate-500 px-3 py-1 text-sm font-semibold text-white"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {!denied && tab === 'users' ? (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-300">
              <th className="py-1">User</th>
              <th>Role</th>
              <th>Status</th>
              <th>Tier</th>
              <th>Phone</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-200">
                <td className="py-1 font-mono text-xs">{u.id.slice(0, 8)}…</td>
                <td>{u.role}</td>
                <td>{u.status}</td>
                <td>{u.verificationTier}</td>
                <td>{u.phone}</td>
                <td>{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {!denied && tab === 'audit' ? (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-300">
              <th className="py-1">When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Subject</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.id} className="border-b border-slate-200">
                <td className="py-1">{new Date(a.at).toLocaleString()}</td>
                <td className="font-mono text-xs">{a.actorId.slice(0, 8)}…</td>
                <td>{a.action}</td>
                <td>
                  {a.subjectKind} {a.subjectId ? a.subjectId.slice(0, 8) + '…' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
