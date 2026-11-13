import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { apiGet, apiPatch, apiPost, apiUpload, onSessionExpired, resetSessionRequests } from './api';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('photo uploads send the original image with cookies and never replay a failed write', async () => {
  const photo = new File(['photo'], 'student.png', { type: 'image/png' });
  const fetcher = vi.fn(async () => json({ avatarUrl: 'https://storage.test/student.png' }));
  vi.stubGlobal('fetch', fetcher);
  await expect(apiUpload('/api/v1/admin/student-photos', photo)).resolves.toHaveProperty('avatarUrl');
  expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/v1/admin/student-photos', {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: photo, credentials: 'include',
  });
  fetcher.mockClear().mockResolvedValue(json({ error: 'Expired' }, 401));
  await expect(apiUpload('/api/v1/admin/student-photos', photo)).rejects.toMatchObject({ status: 401 });
  expect(fetcher).toHaveBeenCalledOnce();
});
beforeEach(() => resetSessionRequests());
afterEach(() => { resetSessionRequests(); vi.unstubAllGlobals(); });

test('concurrent expired reads share one refresh and each retry once with cookies', async () => {
  let release!: (value: Response) => void;
  const renewed = new Promise<Response>(resolve => { release = resolve; });
  const counts: Record<string, number> = {};
  const fetcher = vi.fn((path: string) => {
    counts[path] = (counts[path] ?? 0) + 1;
    if (path === '/api/auth/refresh') return renewed;
    return Promise.resolve(counts[path] === 1 ? json({ error: 'Expired' }, 401) : json({ ok: true }));
  });
  vi.stubGlobal('fetch', fetcher);
  const a = apiGet('/api/v1/grades/me'), b = apiGet('/api/v1/billing/me');
  await vi.waitFor(() => expect(counts['/api/auth/refresh']).toBe(1));
  release(json({ user: {} }));
  await expect(Promise.all([a, b])).resolves.toEqual([{ ok: true }, { ok: true }]);
  expect(counts).toEqual({ '/api/v1/grades/me': 2, '/api/v1/billing/me': 2, '/api/auth/refresh': 1 });
  expect(fetcher.mock.calls.every(call => (call as unknown as [string, RequestInit])[1].credentials === 'include')).toBe(true);
});

test('a late concurrent 401 uses cookies already refreshed by another read', async () => {
  let late!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { late = resolve; });
  const counts: Record<string, number> = {};
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    counts[path] = (counts[path] ?? 0) + 1;
    if (path === '/slow' && counts[path] === 1) return response;
    if (path === '/fast' && counts[path] === 1) return json({}, 401);
    return json({ ok: true });
  }));
  const slow = apiGet('/slow');
  await apiGet('/fast');
  late(json({}, 401));
  await slow;
  expect(counts['/api/auth/refresh']).toBe(1);
});

test('expired refresh credentials invalidate the session without retrying the protected read', async () => {
  const expired = vi.fn(), unsubscribe = onSessionExpired(expired);
  const fetcher = vi.fn(async () => json({ error: 'Expired' }, 401));
  vi.stubGlobal('fetch', fetcher);
  try { await expect(apiGet('/api/auth/me')).rejects.toMatchObject({ status: 401 }); expect(expired).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledTimes(2); }
  finally { unsubscribe(); }
});

test('temporary refresh outages and permission failures do not log out or retry repeatedly', async () => {
  const expired = vi.fn(), unsubscribe = onSessionExpired(expired);
  const fetcher = vi.fn(async (path: string) => json({}, path === '/api/auth/refresh' ? 503 : 401));
  vi.stubGlobal('fetch', fetcher);
  try {
    await expect(apiGet('/api/auth/me')).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockClear().mockImplementation(async () => json({}, 403));
    await expect(apiGet('/api/v1/admin/dashboard')).rejects.toMatchObject({ status: 403 });
    expect(fetcher).toHaveBeenCalledOnce(); expect(expired).not.toHaveBeenCalled();
  } finally { unsubscribe(); }
});

test('authenticated mutations, email sends, and password submissions are never replayed', async () => {
  const fetcher = vi.fn(async (_path: string) => json({ error: 'Denied' }, 401));
  vi.stubGlobal('fetch', fetcher);
  const writes = [() => apiPost('/api/v1/admin/students', {}), () => apiPatch('/api/v1/admin/students/id', {}),
    () => apiPost('/api/v1/admin/students/id/password-recovery', {}), () => apiPost('/api/auth/password/complete', {})];
  for (const write of writes) await expect(write()).rejects.toMatchObject({ status: 401 });
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls.some(call => String(call[0]) === '/api/auth/refresh')).toBe(false);
});

test('aborting one waiter does not cancel a shared refresh for another read', async () => {
  let release!: (value: Response) => void;
  const renewed = new Promise<Response>(resolve => { release = resolve; });
  const counts: Record<string, number> = {};
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    counts[path] = (counts[path] ?? 0) + 1;
    if (path === '/api/auth/refresh') return renewed;
    return json({}, counts[path] === 1 ? 401 : 200);
  }));
  const controller = new AbortController();
  const a = apiGet('/a', controller.signal).catch(error => error), b = apiGet('/b');
  await vi.waitFor(() => expect(counts['/api/auth/refresh']).toBe(1));
  controller.abort(); release(json({}));
  expect((await a as Error).name).toBe('AbortError'); await expect(b).resolves.toEqual({});
  expect(counts['/a']).toBe(1); expect(counts['/b']).toBe(2);
});

test('a read started before sign-out cannot restore the previous session', async () => {
  let release!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { release = resolve; })));
  const pending = apiGet('/api/auth/me'); resetSessionRequests(); release(json({ user: {} }));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});
