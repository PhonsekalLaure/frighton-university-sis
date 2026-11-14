import { test } from 'node:test';
import assert from 'node:assert/strict';
import express, { type RequestHandler } from 'express';
import type { AddressInfo } from 'node:net';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ProfileService, passwordChangeInput } from '../src/services/profileService.js';
import { createProfileRouter } from '../src/routes/profileRoutes.js';
import { createApp } from '../src/app.js';
import { protectCookieRequests } from '../src/middlewares/auth.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';
import { config } from '../src/config/env.js';

const user = { id: 'directory-id', email: 'student@example.edu', fullName: 'Test Middle Student', role: 'student' as const };
const body = { currentPassword: 'old-password', newPassword: 'new-password-2026', confirmPassword: 'new-password-2026' };

function fixture(options: { missing?: boolean; profileEmail?: string; profileRole?: string; inactive?: boolean;
  directoryRole?: string; readError?: boolean; readThrows?: boolean; denied?: boolean; limiterError?: boolean;
  signInStatus?: number; signInThrows?: boolean; wrongIdentity?: boolean; updateStatus?: number;
  updateThrows?: boolean; wrongUpdateIdentity?: boolean; cleanupError?: boolean; cleanupThrows?: boolean } = {}) {
  const calls: Array<{ name: string; value?: any }> = [];
  const account = { users_id: user.id, email: user.email, first_name: 'Test', middle_name: 'Middle', last_name: 'Student',
    role: options.directoryRole ?? 'Students', is_active: !options.inactive };
  const profile = { id: user.id, student_number: 'STU-2026-0001', email: options.profileEmail ?? user.email,
    role: options.profileRole ?? 'student', academic_status: 'active', department: 'Computer Studies', program: 'BSCS',
    year_level: 1, avatar_url: null, created_at: '2026-10-20T00:00:00Z', updated_at: '2026-11-12T00:00:00Z' };
  const directory = {
    from: (table: string) => {
      const q: any = {};
      q.select = (columns: string) => { assert.ok(!columns.includes('*')); assert.ok(!columns.includes('password')); return q; };
      q.eq = (column: string, id: string) => { assert.equal(column, table === 'profiles' ? 'id' : 'users_id'); assert.equal(id, user.id); return q; };
      q.ilike = (_column: string, email: string) => { assert.equal(email, user.email); return q; };
      q.maybeSingle = async () => {
        calls.push({ name: `read:${table}` });
        if (options.readThrows) throw new Error('PRIVATE_DATABASE_DETAIL');
        return { data: table === 'profiles' ? options.missing ? null : profile : account, error: options.readError ? {} : null };
      };
      return q;
    },
    rpc: async (name: string, value: any) => {
      calls.push({ name, value });
      return { data: { allowed: !options.denied, retryAfter: 42 }, error: options.limiterError ? {} : null };
    },
  } as unknown as SupabaseClient;
  const authUser = { id: 'different-auth-id', email: user.email, email_confirmed_at: '2026-10-20' };
  const auth = { auth: {
    signInWithPassword: async (value: any) => {
      calls.push({ name: 'signIn', value });
      if (options.signInThrows) throw new Error('PRIVATE_AUTH_DETAIL');
      return { data: { user: { ...authUser, email: options.wrongIdentity ? undefined : user.email }, session: {} },
        error: options.signInStatus ? { status: options.signInStatus, message: 'PRIVATE_AUTH_DETAIL' } : null };
    },
    updateUser: async (value: any) => {
      calls.push({ name: 'update', value });
      if (options.updateThrows) throw new Error('PRIVATE_AUTH_DETAIL');
      return { data: { user: { id: options.wrongUpdateIdentity ? 'wrong-id' : authUser.id } },
        error: options.updateStatus ? { status: options.updateStatus, message: 'PRIVATE_AUTH_DETAIL' } : null };
    },
    signOut: async (value: any) => {
      calls.push({ name: 'signOut', value });
      if (options.cleanupThrows) throw new Error('PRIVATE_AUTH_DETAIL');
      return { error: options.cleanupError ? {} : null };
    },
  } } as unknown as SupabaseClient;
  return { calls, service: new ProfileService(directory, () => auth) };
}

test('profile reads only the signed-in student and returns basic details without credentials or Auth IDs', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.me(user), { profile: {
    id: user.id, studentNumber: 'STU-2026-0001', firstName: 'Test', middleName: 'Middle', lastName: 'Student',
    fullName: user.fullName, email: user.email, department: 'Computer Studies', program: 'BSCS', yearLevel: 1,
    academicStatus: 'active', avatarUrl: null, createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z',
  } });
  assert.equal(f.calls.some(call => call.name === 'signIn'), false);
});

test('missing, mismatched, inactive, nonstudent, and unavailable profiles fail safely before credential verification', async () => {
  for (const [options, status] of [
    [{ missing: true }, 404], [{ profileEmail: 'other@example.edu' }, 403], [{ profileRole: 'admin' }, 403],
    [{ inactive: true }, 403], [{ directoryRole: 'Admin' }, 403], [{ readError: true }, 503], [{ readThrows: true }, 503],
  ] as const) {
    const f = fixture(options);
    await assert.rejects(() => f.service.changePassword(user, body, '127.0.0.1'), (e: any) => e.status === status && !e.message.includes('PRIVATE'));
    assert.equal(f.calls.some(c => ['signIn', 'update'].includes(c.name)), false);
  }
  await assert.rejects(() => fixture().service.me({ ...user, role: 'admin' }), (e: any) => e.status === 403);
});

test('password validation rejects malformed, extra, mismatched, unchanged, and oversized input without side effects', async () => {
  const f = fixture();
  for (const invalid of [null, [], {}, { ...body, studentId: 'other-id' }, { ...body, email: user.email },
    { ...body, currentPassword: '' }, { ...body, currentPassword: 'x'.repeat(1025) }, { ...body, currentPassword: 'x\0' },
    { ...body, newPassword: 'short' }, { ...body, newPassword: 'x'.repeat(129) }, { ...body, newPassword: 'x'.repeat(12) + '\0' },
    { ...body, confirmPassword: 'different' }, { ...body, confirmPassword: null },
    { currentPassword: body.newPassword, newPassword: body.newPassword, confirmPassword: body.newPassword }]) {
    await assert.rejects(() => f.service.changePassword(user, invalid, '127.0.0.1'), (e: any) => e.status === 400);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(passwordChangeInput({ ...body, currentPassword: '  old  ', newPassword: '  new-password  ', confirmPassword: '  new-password  ' }).newPassword, '  new-password  ');
});

test('password changes verify the current password, resolve separate Auth/directory IDs, update once, and revoke sessions', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.changePassword(user, body, '127.0.0.1'), { requiresLogin: true, sessionsRevoked: true });
  assert.deepEqual(f.calls.find(c => c.name === 'signIn')!.value, { email: user.email, password: body.currentPassword });
  assert.deepEqual(f.calls.filter(c => c.name === 'update'), [{ name: 'update', value: { password: body.newPassword } }]);
  assert.deepEqual(f.calls.at(-1), { name: 'signOut', value: { scope: 'global' } });
  const limits = f.calls.filter(c => c.name === 'sis_reserve_account_request');
  assert.equal(limits.length, 2);
  for (const call of limits) {
    assert.equal(call.value.p_scope, 'password_complete');
    assert.match(call.value.p_key, /^[a-f0-9]{64}$/);
    assert.equal(call.value.p_actor_id, null);
  }
  assert.notEqual(limits[0].value.p_key, limits[1].value.p_key);
});

test('database rate limits fail closed before password verification', async () => {
  for (const [options, status] of [[{ denied: true }, 429], [{ limiterError: true }, 503]] as const) {
    const f = fixture(options);
    await assert.rejects(() => f.service.changePassword(user, body, '127.0.0.1'), (e: any) => e.status === status);
    assert.equal(f.calls.some(c => c.name === 'signIn'), false);
  }
});

test('wrong passwords, provider failures, and mismatched identities never perform unauthorized updates or leak details', async () => {
  for (const [options, status, code] of [
    [{ signInStatus: 400 }, 400, 'incorrect_current_password'], [{ signInStatus: 429 }, 429, 'rate_limited'],
    [{ signInStatus: 503 }, 503, 'password_verification_unavailable'], [{ signInThrows: true }, 503, 'password_verification_unavailable'],
    [{ wrongIdentity: true }, 403, 'account_verification_failed'], [{ updateStatus: 422 }, 400, 'password_update_rejected'],
    [{ updateStatus: 429 }, 429, 'rate_limited'], [{ updateStatus: 503 }, 503, 'password_update_unknown'],
    [{ updateThrows: true }, 503, 'password_update_unknown'], [{ wrongUpdateIdentity: true }, 503, 'password_update_unknown'],
  ] as const) {
    const f = fixture(options);
    await assert.rejects(() => f.service.changePassword(user, body, '127.0.0.1'),
      (e: any) => e.status === status && e.code === code && !e.message.includes('PRIVATE'));
    assert.equal(f.calls.filter(c => c.name === 'update').length, 'updateStatus' in options || 'updateThrows' in options || 'wrongUpdateIdentity' in options ? 1 : 0);
    assert.deepEqual(f.calls.at(-1), { name: 'signOut', value: { scope: 'local' } });
  }
});

test('cleanup failure preserves a confirmed change and reports incomplete session revocation', async () => {
  for (const options of [{ cleanupError: true }, { cleanupThrows: true }]) {
    assert.deepEqual(await fixture(options).service.changePassword(user, body, '127.0.0.1'), { requiresLogin: true, sessionsRevoked: false });
  }
});

test('profile HTTP endpoints enforce authentication, student role, origin, own identity, and cookie cleanup', async () => {
  const f = fixture();
  const authenticate: RequestHandler = (req, res, next) => {
    if (!req.get('x-test-role')) { res.sendStatus(401); return; }
    res.locals.user = { ...user, role: req.get('x-test-role') }; next();
  };
  const app = express().use(protectCookieRequests, express.json({ limit: '10kb' }));
  app.use('/api/v1/profile', createProfileRouter(f.service, authenticate));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/profile`;
  const post = (role = 'student', origin = config.clientUrl, input: unknown = body) => fetch(`${url}/me/password`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-test-role': role, origin }, body: JSON.stringify(input),
  });
  try {
    assert.equal((await fetch(`${url}/me`)).status, 401);
    assert.equal((await fetch(`${url}/me`, { headers: { 'x-test-role': 'admin' } })).status, 403);
    assert.equal((await post('')).status, 401);
    assert.equal((await post('admin')).status, 403);
    assert.equal((await post('student', 'https://evil.invalid')).status, 403);
    assert.equal(f.calls.length, 0);
    const profile = await fetch(`${url}/me?studentId=other-id`, { headers: { 'x-test-role': 'student' } });
    assert.equal(profile.status, 200);
    assert.equal((await profile.json() as any).profile.id, user.id);
    assert.equal((await fetch(`${url}/other-id`, { headers: { 'x-test-role': 'student' } })).status, 404);
    const invalid = await post('student', config.clientUrl, { ...body, studentId: 'other-id' });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get('set-cookie'), null);
    const response = await post();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { requiresLogin: true, sessionsRevoked: true });
    for (const name of ['sis_access', 'sis_refresh', 'sis_remember']) assert.match(response.headers.get('set-cookie')!, new RegExp(`${name}=;`));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('application mounts student profile routes behind real authentication', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/profile`;
  try {
    const read = await fetch(`${url}/me`);
    assert.equal(read.status, 401);
    assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(`${url}/me/password`, { method: 'POST', headers: { origin: config.clientUrl } })).status, 401);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('uncertain HTTP password updates clear cookies, expose no secrets, and are never retried', async () => {
  const f = fixture({ updateThrows: true });
  const app = express().use(protectCookieRequests, express.json());
  app.use('/api/v1/profile', createProfileRouter(f.service, (_req, res, next) => { res.locals.user = user; next(); }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/profile/me/password`, {
      method: 'POST', headers: { origin: config.clientUrl, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 503);
    const result = await response.json() as any;
    assert.equal(result.code, 'password_update_unknown');
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
    assert.equal(f.calls.filter(c => c.name === 'update').length, 1);
    for (const name of ['sis_access', 'sis_refresh', 'sis_remember']) assert.match(response.headers.get('set-cookie')!, new RegExp(`${name}=;`));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
