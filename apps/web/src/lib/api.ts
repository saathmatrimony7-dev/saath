/**
 * Browser-side API client for the Core API through the same-origin
 * /api/core/* proxy (see next.config.ts rewrites).
 *
 * Auth tokens never reach JS: the API keeps saath_at / saath_rt in httpOnly
 * cookies; only the CSRF double-submit cookie is JS-readable (by design) and
 * is sent as the x-csrf-token header on every mutating request. Never store
 * any token in localStorage or state (frontend-engineer rules).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `request failed with status ${status}`);
  }
}

function csrfHeader(): Record<string, string> {
  const match = document.cookie.match(/(?:^|;\s*)saath_csrf=([^;]*)/);
  const value = match?.[1];
  return value ? { 'x-csrf-token': decodeURIComponent(value) } : {};
}

async function parseError(res: Response): Promise<never> {
  let message: string | undefined;
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === 'string') message = body.message;
  } catch {
    // non-JSON error body — status code is enough
  }
  throw new ApiError(res.status, message);
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/core${path}`, { credentials: 'same-origin' });
  if (!res.ok) await parseError(res);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/core${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...csrfHeader() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) await parseError(res);
  return (await res.json()) as T;
}

export interface SseFrame {
  type: 'delta' | 'done';
  delta?: string;
  status?: string;
  reply?: string;
}

/**
 * POSTs one chat turn and reads the SSE reply stream (the API sends only
 * `data:` frames). EventSource cannot set the CSRF header, so we use fetch
 * with a stream reader (same pattern as the API's own tests).
 */
export async function postTurnStream(
  sessionId: string,
  text: string,
  onDelta: (delta: string) => void,
): Promise<{ status: string; reply: string }> {
  const res = await fetch(`/api/core/onboarding/sessions/${sessionId}/messages`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...csrfHeader() },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) await parseError(res);
  if (!res.body) throw new ApiError(res.status, 'response body is empty');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reply = '';
  let status = 'in_progress';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith('data: ')) continue;
      const data = JSON.parse(line.slice(6)) as SseFrame;
      if (data.type === 'delta' && typeof data.delta === 'string') {
        reply += data.delta;
        onDelta(data.delta);
      } else if (data.type === 'done') {
        status = data.status ?? status;
        reply = data.reply ?? reply;
      }
    }
  }
  return { status, reply };
}
