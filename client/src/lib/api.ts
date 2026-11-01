export type ApiFailure = Error & { status?: number; code?: string; retryAfter?: number };

const expiredListeners = new Set<() => void>();
let refresh: Promise<void> | undefined;
let refreshController: AbortController | undefined;
let sessionVersion = 0;
let sessionEpoch = 0;

export function onSessionExpired(listener: () => void) {
  expiredListeners.add(listener);
  return () => { expiredListeners.delete(listener); };
}

export function resetSessionRequests() {
  sessionEpoch++;
  sessionVersion++;
  refreshController?.abort();
  refreshController = undefined;
  refresh = undefined;
}

function expireSession() {
  resetSessionRequests();
  expiredListeners.forEach(listener => listener());
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'include' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = new Error(data.error ?? 'The request could not be completed.') as ApiFailure;
    failure.status = response.status;
    failure.code = data.code;
    const seconds = Number(response.headers.get('Retry-After'));
    if (seconds > 0 && Number.isFinite(seconds)) failure.retryAfter = seconds;
    throw failure;
  }
  return data as T;
}

function refreshSession(): Promise<void> {
  if (!refresh) {
    const controller = new AbortController();
    refreshController = controller;
    const pending = send('/api/auth/refresh', { method: 'POST', signal: controller.signal })
      .then(() => { controller.signal.throwIfAborted(); sessionVersion++; })
      .catch((error: ApiFailure) => {
        if (error.status === 401 || error.status === 403) expireSession();
        throw error;
      })
      .finally(() => {
        if (refresh === pending) { refresh = undefined; refreshController = undefined; }
      });
    refresh = pending;
  }
  return refresh;
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const version = sessionVersion;
  const epoch = sessionEpoch;
  try {
    const data = await send<T>(path, { signal });
    if (epoch !== sessionEpoch) throw new DOMException('Session changed.', 'AbortError');
    return data;
  } catch (error) {
    if (epoch !== sessionEpoch) throw new DOMException('Session changed.', 'AbortError');
    if ((error as ApiFailure).status !== 401 || signal?.aborted) throw error;
    // A slower concurrent 401 can arrive after another read renewed the cookies.
    if (version === sessionVersion) await refreshSession();
    signal?.throwIfAborted();
    if (epoch !== sessionEpoch) throw new DOMException('Session changed.', 'AbortError');
    try {
      const data = await send<T>(path, { signal });
      if (epoch !== sessionEpoch) throw new DOMException('Session changed.', 'AbortError');
      return data;
    } catch (retryError) {
      if ((retryError as ApiFailure).status === 401) expireSession();
      throw retryError;
    }
  }
}

async function write<T>(path: string, method: string, body: unknown): Promise<T> {
  try {
    return await send<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (error) {
    if (path.startsWith('/api/v1/') && (error as ApiFailure).status === 401) expireSession();
    throw error;
  }
}

export const apiPost = <T>(path: string, body: unknown) => write<T>(path, 'POST', body);
export const apiPatch = <T>(path: string, body: unknown) => write<T>(path, 'PATCH', body);
