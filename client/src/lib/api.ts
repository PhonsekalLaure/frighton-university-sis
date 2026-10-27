export type ApiFailure = Error & { status: number; code?: string; retryAfter?: number };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'include' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = new Error(data.error ?? 'The request could not be completed.') as ApiFailure;
    failure.status = response.status;
    failure.code = data.code;
    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter) failure.retryAfter = Number(retryAfter);
    throw failure;
  }
  return data as T;
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { signal });
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
