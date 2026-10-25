/**
 * Browser-side API client for the Core API through the same-origin proxy.
 * Same guarantees as apps/web: tokens stay in httpOnly cookies; only the CSRF
 * double-submit cookie is read for the header.
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
